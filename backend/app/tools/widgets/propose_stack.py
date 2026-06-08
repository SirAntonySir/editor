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
    if param.type == "scalar":
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

        # Phase 1/2 LLM paths land in Tasks 9 + 10.
        raise NotImplementedError("planner path lands in Task 9")

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
