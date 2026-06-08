from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field

from app.registry.loader import get_registry
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
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


class _Input(BaseModel):
    intent: str = Field(min_length=1)
    scope: dict
    origin: WidgetOriginKind = "mcp_user_prompt"
    layer_id: str = "legacy"
    forced_ops: list[str] | None = None     # bypass Phase 1
    preset_id: str | None = None            # unfold a registry preset directly
    prompt: str | None = None


class _Output(BaseModel):
    widgets: list[dict]


def _control_schema_for(op_id: str, param_key: str) -> ControlSchema:
    """Build a ControlSchema from a registry op param + binding.

    Uses the registry's control_type vocabulary verbatim — no mapping needed
    now that ControlType includes all registry-vocab values.
    """
    reg = get_registry()
    op = reg.ops[op_id]
    param = op.params[param_key]
    binding = next(b for b in op.bindings if b.param_key == param_key)
    ct = binding.control_type
    payload: dict = {"control_type": ct}

    if ct in ("slider", "kelvin_strip") and param.type == "scalar":
        assert param.range is not None
        payload["min"], payload["max"] = param.range
        payload["step"] = param.step if param.step is not None else 1
        if param.unit:
            payload["unit"] = param.unit
    elif ct == "hue_wheel" and param.type == "scalar":
        assert param.range is not None
        payload["min"], payload["max"] = param.range
    elif ct == "swatch":
        pass  # SwatchSchema has no required extra fields
    elif ct in ("curve_editor", "point_list") and param.type == "curve_points":
        payload["min_points"] = param.min_points or 2
        payload["max_points"] = param.max_points or 16
    elif ct == "enum_select" and param.type == "enum" and param.values:
        payload["options"] = [{"value": v, "label": v} for v in param.values]
    elif ct == "bool_toggle":
        pass  # BoolToggleSchema has on_label/off_label defaults

    return ControlSchema.model_validate(payload)


def _normalize_plan_entries(raw_entries: list[dict]) -> list[dict]:
    """Transform OLD-shape entries ({op_id, rationale}) into NEW shape
    ({widget_name: None, category: None, ops: [{op_id, rationale, starting_params}]}).
    NEW-shape entries pass through unchanged.
    """
    normalized: list[dict] = []
    for entry in raw_entries:
        if "ops" in entry:
            normalized.append(entry)
            continue
        normalized.append({
            "widget_name": None,
            "category": None,
            "ops": [{
                "op_id": entry.get("op_id"),
                "rationale": entry.get("rationale", ""),
                "starting_params": entry.get("starting_params"),
            }],
        })
    return normalized


def _dedup_plan(raw_plan: list[dict]) -> list[dict]:
    """Collapse same-op-id repeats.

    Within a widget: if `ops` has the same op_id twice, merge into one
    (params merged last-write-wins, rationales concatenated).

    Cross-widget: if two entries have the same sorted op_id signature,
    merge into one (first widget_name/category wins, per-op params merged).
    """
    # --- Within-widget dedup ---
    for entry in raw_plan:
        seen: dict[str, dict] = {}
        merged_ops: list[dict] = []
        for op in entry.get("ops", []):
            op_id = op.get("op_id")
            if op_id is None:
                continue
            if op_id in seen:
                target = seen[op_id]
                target["starting_params"] = {
                    **(target.get("starting_params") or {}),
                    **(op.get("starting_params") or {}),
                }
                if op.get("rationale"):
                    sep = " · " if target.get("rationale") else ""
                    target["rationale"] = (target.get("rationale") or "") + sep + op["rationale"]
            else:
                # Defensive copy so cross-widget pass doesn't mutate shared dicts.
                seen[op_id] = dict(op)
                seen[op_id]["starting_params"] = dict(op.get("starting_params") or {})
                merged_ops.append(seen[op_id])
        entry["ops"] = merged_ops

    # --- Cross-widget dedup ---
    by_signature: dict[tuple[str, ...], dict] = {}
    deduped: list[dict] = []
    for entry in raw_plan:
        sig = tuple(sorted(op["op_id"] for op in entry.get("ops", [])))
        if not sig:
            continue
        if sig in by_signature:
            target_entry = by_signature[sig]
            # Build a map of target ops by id for quick merge.
            target_ops_by_id = {o["op_id"]: o for o in target_entry["ops"]}
            for op in entry["ops"]:
                target_op = target_ops_by_id[op["op_id"]]
                target_op["starting_params"] = {
                    **(target_op.get("starting_params") or {}),
                    **(op.get("starting_params") or {}),
                }
                if op.get("rationale"):
                    sep = " · " if target_op.get("rationale") else ""
                    target_op["rationale"] = (target_op.get("rationale") or "") + sep + op["rationale"]
        else:
            by_signature[sig] = entry
            deduped.append(entry)
    return deduped


def _build_widget_multi(
    *, widget_name: str | None,
    category: str | None,
    ops: list[tuple[str, dict[str, Any]]],
    intent: str,
    scope: Scope,
    origin: WidgetOrigin,
    layer_id: str,
    image_node_layer_ids: list[str] | None,
) -> Widget:
    """Build a single Widget composed of one or more ops. One WidgetNode per op."""
    if not ops:
        raise ValueError("_build_widget_multi requires at least one op")

    reg = get_registry()
    widget_id = f"w_{uuid.uuid4().hex[:8]}"

    nodes: list[WidgetNode] = []
    bindings: list[ControlBinding] = []
    for op_id, params in ops:
        if op_id not in reg.ops:
            raise ValueError(f"unknown op id: {op_id!r}")
        op = reg.ops[op_id]
        node_id = f"n_{uuid.uuid4().hex[:6]}"

        # Merge defaults into params for this op.
        full_params = {
            key: params.get(key, p.default) for key, p in op.params.items()
        }

        nodes.append(WidgetNode(
            id=node_id,
            type=op.engine.node_type,
            params=full_params,
            scope=scope,
            inputs=[],
            widget_id=widget_id,
            layer_id=(image_node_layer_ids[0] if image_node_layer_ids else layer_id),
            layer_ids=image_node_layer_ids,
        ))

        for b in op.bindings:
            bindings.append(ControlBinding(
                param_key=b.param_key,
                label=b.label,
                control_type=b.control_type,
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
        op_id=ops[0][0],          # first op's id for back-compat
        composed=False,
        nodes=nodes,
        bindings=bindings,
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[],
        status="active",
        revision=1,
        display_name=widget_name,
        category=category,
    )


def _build_widget(
    *, op_id: str, params: dict, intent: str, scope: Scope,
    origin: WidgetOrigin, layer_id: str, image_node_layer_ids: list[str] | None,
    exposed_param_keys: set[str] | None = None,
    display_name: str | None = None, category: str | None = None,
) -> Widget:
    """Build a single-op widget.

    If ``exposed_param_keys`` is given, only bindings whose ``param_key`` is in
    that set are included in the widget's controls. The node still receives ALL
    op params at their defaults so the shader pipeline stays complete.

    For the common case (no param filtering), this is a thin wrapper around
    ``_build_widget_multi``.
    """
    if exposed_param_keys is None:
        return _build_widget_multi(
            widget_name=display_name,
            category=category,
            ops=[(op_id, params)],
            intent=intent,
            scope=scope,
            origin=origin,
            layer_id=layer_id,
            image_node_layer_ids=image_node_layer_ids,
        )

    # Param-filtered path (used by preset spawning with per-band exposure).
    reg = get_registry()
    op = reg.ops[op_id]
    widget_id = f"w_{uuid.uuid4().hex[:8]}"
    node_id = f"n_{uuid.uuid4().hex[:6]}"

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
        if b.param_key not in exposed_param_keys:
            continue
        bindings.append(ControlBinding(
            param_key=b.param_key,
            label=b.label,
            control_type=b.control_type,
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
        op_id=op_id,
        composed=False,
        nodes=[node],
        bindings=bindings,
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[],
        status="active",
        revision=1,
        display_name=display_name,
        category=category,
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

        # preset_id takes priority over both the toolrail fast-path and the LLM
        # path — it works with any origin including tool_invoked.
        if input.preset_id is not None:
            return self._handle_preset_spawn(doc, input, scope)

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

        plan_result = await asyncio.to_thread(
            anthropic.plan_widget_stack,
            intent=input.intent,
            scope=input.scope,
            image_context=image_context,
            existing_widgets=[
                {"op_id": w.op_id or "unknown"} for w in doc.widgets.values()
            ],
            registry=reg,
            session_id=doc.session_id,
        )

        raw_plan = plan_result.get("plan") or []
        # Old-shape → new-shape transform (back-compat).
        plan_entries = _normalize_plan_entries(raw_plan)
        # Dedup within and across widgets.
        plan_entries = _dedup_plan(plan_entries)

        # Fallback if nothing remains: keyword preset.
        if not plan_entries:
            fallback_ops = self._fallback_plan(input.intent, reg)
            plan_entries = [{
                "widget_name": None, "category": None,
                "ops": [{"op_id": op["op_id"], "rationale": "",
                         "starting_params": op.get("starting_params")} for op in fallback_ops],
            }] if fallback_ops else []

        # Phase 2: resolve each (entry_index, op) in parallel.
        async def _resolve_one(entry_index: int, op_entry: dict) -> tuple[int, str, dict] | None:
            op_id = op_entry.get("op_id")
            if op_id not in reg.ops:
                return None
            op = reg.ops[op_id]
            try:
                params = await asyncio.to_thread(
                    anthropic.resolve_widget_params,
                    op=op, intent=input.intent,
                    rationale=op_entry.get("rationale", ""),
                    starting_params=op_entry.get("starting_params") or {},
                    image_context=image_context, session_id=doc.session_id,
                )
            except Exception as exc:    # noqa: BLE001
                print(f"[propose_stack] resolve failed for {op_id}: {exc}")
                return None
            return (entry_index, op_id, params)

        flat_ops = [
            (i, op) for i, entry in enumerate(plan_entries) for op in entry["ops"]
        ]
        resolved_flat = [r for r in await asyncio.gather(
            *(_resolve_one(i, op) for i, op in flat_ops)
        ) if r is not None]

        # Group resolved params by entry_index, preserving op order within each entry.
        by_entry: dict[int, list[tuple[str, dict]]] = {}
        for entry_index, op_id, params in resolved_flat:
            by_entry.setdefault(entry_index, []).append((op_id, params))

        image_node_layer_ids = (
            list(scope.root.layer_ids) if scope.root.kind == "image_node" else None
        )
        origin = WidgetOrigin(
            kind=input.origin, prompt=input.prompt or input.intent,
            parent_widget_id=None,
        )

        widgets: list[Widget] = []
        for entry_index, entry in enumerate(plan_entries):
            ops_for_entry = by_entry.get(entry_index, [])
            if not ops_for_entry:
                continue   # all ops failed resolution — drop the widget
            widget = _build_widget_multi(
                widget_name=entry.get("widget_name"),
                category=entry.get("category"),
                ops=ops_for_entry,
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

    def _handle_preset_spawn(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        """Unfold a named registry preset into widgets. No LLM call.

        Each PresetOp in reg.presets[preset_id] becomes one widget via
        _build_widget. Works for any origin (tool_invoked, mcp_user_prompt,
        mcp_autonomous).
        """
        assert input.preset_id is not None
        reg = get_registry()
        if input.preset_id not in reg.presets:
            raise ValueError(f"unknown preset id: {input.preset_id!r}")
        preset = reg.presets[input.preset_id]

        image_node_layer_ids = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)

        origin = WidgetOrigin(
            kind=input.origin,
            prompt=input.prompt or input.intent,
            parent_widget_id=None,
        )

        widgets: list[Widget] = []
        for p in preset.ops:
            if p.op_id not in reg.ops:
                continue
            # If the preset specifies only a subset of the op's params, expose
            # only those as controls (the node still gets all defaults for the
            # shader pipeline). This preserves per-band HSL semantics where
            # tone_red only exposes {red_hue, red_sat, red_lum}.
            exposed = set(p.params.keys()) if p.params else None
            widget = _build_widget(
                op_id=p.op_id,
                params=p.params,
                intent=input.intent,
                scope=scope,
                origin=origin,
                layer_id=input.layer_id,
                image_node_layer_ids=image_node_layer_ids,
                exposed_param_keys=exposed if exposed else None,
            )
            doc.add_widget(widget)
            widgets.append(widget)

        return _Output(widgets=[w.model_dump(mode="json") for w in widgets])

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
