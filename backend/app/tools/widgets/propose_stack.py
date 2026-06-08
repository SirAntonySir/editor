from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.registry.loader import get_registry
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    ControlType,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetOriginKind,
    WidgetPreview,
)
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions

# ---------------------------------------------------------------------------
# Registry CONTROL_TYPE → widget ControlType mapping
# The SSoT registry uses its own control_type vocabulary; ControlBinding.control_type
# uses the widget schema vocabulary. Map the mismatches here.
# ---------------------------------------------------------------------------
_CONTROL_TYPE_MAP: dict[str, ControlType] = {
    "slider": "slider",
    "swatch": "color",
    "hue_wheel": "color",
    "curve_editor": "curve",
    "point_list": "curve",
    "enum_select": "choice",
    "bool_toggle": "toggle",
    "kelvin_strip": "slider",
}


def _map_control_type(registry_ct: str) -> ControlType:
    mapped = _CONTROL_TYPE_MAP.get(registry_ct)
    if mapped is None:
        raise ValueError(f"unknown registry control_type: {registry_ct!r}")
    return mapped


class _Input(BaseModel):
    intent: str = Field(min_length=1)
    scope: dict
    origin: WidgetOriginKind = "mcp_user_prompt"
    layer_id: str = "legacy"
    forced_ops: list[str] | None = None     # bypass Phase 1
    prompt: str | None = None


class _Output(BaseModel):
    widgets: list[dict]


def _control_schema_for(op_id: str, param_key: str) -> ControlSchema:
    """Build a ControlSchema from a registry op param + binding."""
    reg = get_registry()
    op = reg.ops[op_id]
    param = op.params[param_key]
    binding = next(b for b in op.bindings if b.param_key == param_key)
    payload: dict = {"control_type": _map_control_type(binding.control_type)}
    mapped_ct = payload["control_type"]
    if param.type == "scalar" and mapped_ct == "slider":
        assert param.range is not None
        payload["min"], payload["max"] = param.range
        payload["step"] = 1
        if param.unit:
            payload["unit"] = param.unit
    elif param.type == "curve_points":
        payload["min_points"] = param.min_points or 2
        payload["max_points"] = param.max_points or 16
    return ControlSchema.model_validate(payload)


def _build_widget(
    *, op_id: str, params: dict, intent: str, scope: Scope,
    origin: WidgetOrigin, layer_id: str, image_node_layer_ids: list[str] | None,
) -> Widget:
    reg = get_registry()
    op = reg.ops[op_id]
    widget_id = f"w_{uuid.uuid4().hex[:8]}"
    node_id = f"n_{uuid.uuid4().hex[:6]}"

    # Merge defaults into params (any unspecified key gets its default).
    full_params = {
        key: params.get(key, p.default) for key, p in op.params.items()
    }

    node = WidgetNode(
        id=node_id,
        type=op.engine.node_type,
        params=full_params,
        scope=scope,
        inputs=[],
        widget_id=widget_id,
        layer_id=(image_node_layer_ids[0] if image_node_layer_ids else layer_id),
        layer_ids=image_node_layer_ids,
    )

    bindings: list[ControlBinding] = []
    for b in op.bindings:
        bindings.append(ControlBinding(
            param_key=b.param_key,
            label=b.label,
            control_type=_map_control_type(b.control_type),
            control_schema=_control_schema_for(op_id, b.param_key),
            value=full_params[b.param_key],
            default=op.params[b.param_key].default,
            target=NodeParamTarget(node_id=node_id, param_key=b.param_key),
        ))

    return Widget(
        id=widget_id,
        intent=intent,
        scope=scope,
        origin=origin,
        fused_tool_id=op_id,
        composed=False,
        nodes=[node],
        bindings=bindings,
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[],
        status="active",
        revision=1,
    )


class ProposeStackTool(BackendTool[_Input, _Output]):
    name = "propose_stack"
    kind = "mutate"
    description = (
        "Propose a stack of 1–6 widgets for an intent. tool_invoked origin "
        "uses forced_ops; mcp_* origins use the two-phase planner."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        scope = Scope.model_validate(input.scope)

        if input.origin == "tool_invoked":
            return self._handle_tool_invoked(doc, input, scope)

        if doc.image_context is None:
            from app.tools.widgets.propose_widget import _MissingContext
            raise _MissingContext("call analyze_image first")

        return await self._handle_llm_path(doc, input, scope)

    async def _handle_llm_path(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        import asyncio

        from app.api import deps
        from app.registry.loader import get_registry

        reg = get_registry()
        anthropic = deps.get_anthropic_client()
        image_context = doc.image_context.model_dump(mode="json")

        plan_result = anthropic.plan_widget_stack(
            intent=input.intent,
            scope=input.scope,
            image_context=image_context,
            existing_widgets=[
                {"op_id": w.fused_tool_id or "unknown"} for w in doc.widgets.values()
            ],
            registry=reg,
            session_id=doc.session_id,
        )

        planned_ops = plan_result.get("plan") or self._fallback_plan(input.intent, reg)

        # Phase 2: resolve each op's params in parallel.
        async def _resolve_one(entry: dict) -> tuple[str, dict] | None:
            op_id = entry.get("op_id")
            if op_id not in reg.ops:
                return None
            op = reg.ops[op_id]
            try:
                params = await asyncio.to_thread(
                    anthropic.resolve_widget_params,
                    op=op,
                    intent=input.intent,
                    rationale=entry.get("rationale", ""),
                    starting_params=entry.get("starting_params") or {},
                    image_context=image_context,
                    session_id=doc.session_id,
                )
            except Exception as exc:  # noqa: BLE001
                # Drop this op; others still spawn.
                print(f"[propose_stack] resolve failed for {op_id}: {exc}")
                return None
            return (op_id, params)

        resolved = [
            r for r in await asyncio.gather(*(_resolve_one(e) for e in planned_ops))
            if r is not None
        ]

        image_node_layer_ids = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)

        origin = WidgetOrigin(
            kind=input.origin,
            prompt=input.prompt or input.intent,
            parent_widget_id=None,
        )

        widgets: list[Widget] = []
        for op_id, params in resolved:
            widget = _build_widget(
                op_id=op_id,
                params=params,
                intent=input.intent,
                scope=scope,
                origin=origin,
                layer_id=input.layer_id,
                image_node_layer_ids=image_node_layer_ids,
            )
            doc.add_widget(widget)
            widgets.append(widget)

        return _Output(widgets=[w.model_dump(mode="json") for w in widgets])

    def _fallback_plan(self, intent: str, registry) -> list[dict]:
        """Keyword match intent to a preset, else first preset's ops."""
        lower = intent.lower()
        for preset_id, preset in registry.presets.items():
            if preset_id in lower or any(tag in lower for tag in preset.semantic_tags):
                return [{"op_id": p.op_id, "starting_params": p.params}
                        for p in preset.ops]
        if registry.presets:
            first = next(iter(registry.presets.values()))
            return [{"op_id": p.op_id, "starting_params": p.params}
                    for p in first.ops]
        return []

    def _handle_tool_invoked(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        if not input.forced_ops:
            raise ValueError("tool_invoked origin requires forced_ops")
        reg = get_registry()

        image_node_layer_ids = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)

        origin = WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None)
        widgets: list[Widget] = []
        for op_id in input.forced_ops:
            if op_id not in reg.ops:
                raise ValueError(f"unknown op id: {op_id!r}")
            widget = _build_widget(
                op_id=op_id, params={}, intent=input.intent, scope=scope,
                origin=origin, layer_id=input.layer_id,
                image_node_layer_ids=image_node_layer_ids,
            )
            doc.add_widget(widget)
            widgets.append(widget)

        return _Output(widgets=[w.model_dump(mode="json") for w in widgets])
