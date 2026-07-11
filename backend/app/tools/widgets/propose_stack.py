from __future__ import annotations

import re
import uuid
from typing import Any

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
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
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.hsl_bindings import pad_hsl_bindings


class _MissingContext(Exception):
    """Mapped to missing_context in the envelope by the registry. Raised by
    the LLM path when analyze_context hasn't run yet."""
    pass


class _ProposalFailed(Exception):
    """Mapped to proposal_failed in the envelope by the registry. Raised when
    neither the LLM path nor the keyword fallback can produce a stack — the
    user gets a visible error instead of an arbitrary preset widget."""
    pass


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    intent: str = Field(min_length=1)
    scope: dict
    origin: WidgetOriginKind = "mcp_user_prompt"
    layer_id: str = "legacy"
    forced_ops: list[str] | None = None     # bypass Phase 1
    # Per-op initial param overrides for the tool_invoked / forced_ops path.
    # Used by the frontend's auto-tune flow to spawn widgets with mechanically
    # derived starting values rather than registry defaults. Unknown params
    # are dropped silently by `_build_widget` via param-schema filtering.
    forced_params: dict[str, dict[str, Any]] | None = None
    preset_id: str | None = None            # unfold a registry preset directly
    prompt: str | None = None
    # Full layer set of the active image-node. Lets toolrail / pin spawns
    # broadcast a node-scope widget across every layer in a multi-layer
    # image-node even when the scope itself is `global` or `mask`-rooted
    # (those scopes don't carry image-node layer ids). Always optional —
    # the LLM-driven planner derives image_node_layer_ids from `scope.root`
    # instead.
    layer_ids: list[str] | None = None


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

    if ct in ("slider", "kelvin_strip", "tint_strip") and param.type == "scalar":
        # tint_strip shares slider/kelvin_strip's schema (min/max/step required;
        # unit optional). Without this branch white-balance widgets fail
        # ControlSchema validation on the tint binding and never spawn.
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
            entry.setdefault("driver_label", None)
            normalized.append(entry)
            continue
        normalized.append({
            "widget_name": None,
            "category": None,
            "driver_label": None,
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


def _op_display(op_id: str) -> str:
    """Humanize a registry op id for binding labels: `clarity` → "Clarity",
    `splitTone` → "Split tone", `time-of-day` → "Time of day"."""
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", op_id)
    words = words.replace("-", " ").replace("_", " ")
    return words[:1].upper() + words[1:].lower()


def _attach_fused_compound(widget: Widget, doc: Any, driver_label: str | None) -> None:
    """Fused intent widgets: LLM-proposed widgets get a synthesized driver.
    tool_invoked / preset spawns don't — "I picked a tool" ships raw controls.
    Mutates the widget in place (no-op when synthesis declines)."""
    if widget.origin.kind not in ("mcp_user_prompt", "mcp_autonomous"):
        return
    from app.tools.widgets.fused_compound import synthesize_compound
    block = synthesize_compound(widget, doc, driver_label=driver_label)
    if block is None:
        return
    widget.compound = block
    widget.driver_value = 1.0


def _build_widget_multi(
    *, widget_name: str | None,
    category: str | None,
    ops: list[tuple[str, dict[str, Any]]],
    intent: str,
    scope: Scope,
    origin: WidgetOrigin,
    layer_id: str,
    image_node_layer_ids: list[str] | None,
    doc: "SessionDocument | None" = None,
) -> Widget:
    """Build a single Widget composed of one or more ops. One WidgetNode per op."""
    if not ops:
        raise ValueError("_build_widget_multi requires at least one op")

    reg = get_registry()
    widget_id = f"w_{uuid.uuid4().hex[:8]}"

    # Cross-op label collisions: registry ops label their primary param
    # generically ("Amount" on clarity, sharpen, grain, vignette, …), which is
    # fine solo but renders identical sliders when the planner composes two
    # such ops into one widget. Pre-pass: which labels appear under more than
    # one op? Those bindings adopt the op's display name instead — the same
    # convention the hand-built fused templates use ("Clarity" / "Sharpen").
    label_ops: dict[str, set[str]] = {}
    for op_id, _ in ops:
        op = reg.ops.get(op_id)
        if op is None:
            continue  # unknown op raises in the main loop below
        for b in op.bindings:
            label_ops.setdefault(b.label, set()).add(op_id)

    nodes: list[WidgetNode] = []
    bindings: list[ControlBinding] = []
    for op_id, params in ops:
        if op_id not in reg.ops:
            raise ValueError(f"unknown op id: {op_id!r}")
        op = reg.ops[op_id]
        node_id = f"n_{uuid.uuid4().hex[:6]}"

        # Canonical state we may have written from a prior inspector edit on
        # the same (layer, op). Pin/promote should *preserve* those values
        # instead of resetting to registry defaults — without this, the user
        # edits curves in the panel, hits Pin, and watches the canvas snap
        # back to identity. Precedence: explicit `params` (auto-tune / preset
        # / LLM resolve) > existing canonical > registry default.
        canonical_for_op: dict[str, Any] = {}
        if doc is not None:
            canonical_for_op = (
                doc.canonical.get(layer_id, {}).get(op.engine.node_type, {}) or {}
            )
        full_params = {
            key: params[key] if key in params
                else canonical_for_op.get(key, p.default)
            for key, p in op.params.items()
        }

        nodes.append(WidgetNode(
            id=node_id,
            type=op.engine.node_type,
            op_id=op_id,                # NEW — source registry op id for frontend identification
            params=full_params,
            scope=scope,
            inputs=[],
            widget_id=widget_id,
            layer_id=(image_node_layer_ids[0] if image_node_layer_ids else layer_id),
            layer_ids=image_node_layer_ids,
        ))

        # Labels this op contributes that collide with another op's. One
        # colliding label → the op display name alone ("Clarity"); several →
        # keep the param context too ("Clarity amount", "Clarity radius").
        colliding_in_op = [
            b.label for b in op.bindings if len(label_ops.get(b.label, ())) > 1
        ]
        for b in op.bindings:
            label = b.label
            if len(label_ops.get(b.label, ())) > 1:
                display = _op_display(op_id)
                label = display if len(colliding_in_op) == 1 else f"{display} {b.label.lower()}"
            bindings.append(ControlBinding(
                param_key=b.param_key,
                label=label,
                control_type=b.control_type,
                control_schema=_control_schema_for(op_id, b.param_key),
                value=full_params[b.param_key],
                default=op.params[b.param_key].default,
                target=NodeParamTarget(node_id=node_id, param_key=b.param_key),
            ))

    # Composed widgets carrying an hsl node bind all 8 bands too (see above).
    bindings = pad_hsl_bindings(nodes, bindings)

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
    doc: "SessionDocument | None" = None,
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
            doc=doc,
        )

    # Param-filtered path (used by preset spawning with per-band exposure).
    reg = get_registry()
    op = reg.ops[op_id]
    widget_id = f"w_{uuid.uuid4().hex[:8]}"
    node_id = f"n_{uuid.uuid4().hex[:6]}"

    # Same precedence as _build_widget_multi: explicit params > existing
    # canonical > registry default. Keeps presets that re-spawn an already-
    # edited op from snapping back to identity.
    canonical_for_op: dict[str, Any] = {}
    if doc is not None:
        canonical_for_op = (
            doc.canonical.get(layer_id, {}).get(op.engine.node_type, {}) or {}
        )
    full_params = {
        key: params[key] if key in params
            else canonical_for_op.get(key, p.default)
        for key, p in op.params.items()
    }

    node = WidgetNode(
        id=node_id,
        type=op.engine.node_type,
        op_id=op_id,                # NEW — source registry op id for frontend identification
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

    # HSL widgets always bind all 8 bands so the frontend "+ add colour" can
    # reveal any of them; a curated subset (e.g. the tone_red preset) only
    # seeds the bands it tunes.
    bindings = pad_hsl_bindings([node], bindings)

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
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        intent = (input.intent or "adjustment").strip()
        # Capitalise first letter for a friendlier label.
        intent_cap = intent[:1].upper() + intent[1:] if intent else "Adjustment"
        return f"Proposed {intent_cap}"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        scope = Scope.model_validate(input.scope)

        # Cockpit telemetry: capture the user's natural-language ask so the
        # admin views can show "what did they actually type". `intent` is
        # the canonical field; `prompt` is what the palette sent verbatim.
        from app.services.event_journal import write_event
        write_event(doc.session_id, "prompt.entered", {
            "origin": input.origin,
            "intent": input.intent,
            "prompt": input.prompt,
            "scope_kind": scope.root.kind,
            "forced_ops": list(input.forced_ops) if input.forced_ops else None,
            "preset_id": input.preset_id,
        })

        # preset_id takes priority over both the toolrail fast-path and the LLM
        # path — it works with any origin including tool_invoked.
        if input.preset_id is not None:
            return self._handle_preset_spawn(doc, input, scope)

        if input.origin == "tool_invoked":
            return self._handle_tool_invoked(doc, input, scope)

        if doc.get_image_context(DEFAULT_IMAGE_NODE_ID) is None:
            raise _MissingContext("call prepare_image then analyze_context first")

        return await self._handle_llm_path(doc, input, scope)

    async def _handle_llm_path(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        import asyncio

        from app.api import deps
        from app.registry.loader import get_registry

        reg = get_registry()
        anthropic = deps.get_anthropic_client()
        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        assert ctx is not None  # guarded above
        # Strip mask_png_base64, paths, and the 256-bin histograms before
        # handing to Claude — see `image_context_for_llm` docstring.
        # Without this, every plan + resolve call ships ~28 k tokens of
        # binary mask data and pre-rendered chart bins (~96 % of the call).
        from app.services.llm_context import image_context_for_llm
        image_context = image_context_for_llm(
            ctx.model_dump(mode="json", by_alias=True),
        )

        from app.services.event_journal import write_event

        try:
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
        except Exception as exc:  # noqa: BLE001 — planner exhausted its retry
            write_event(doc.session_id, "proposal.health", {
                "stage": "plan", "event": "planner_failed", "detail": str(exc)[:500],
            })
            plan_result = {"plan": []}

        raw_plan = plan_result.get("plan") or []
        # Old-shape → new-shape transform (back-compat).
        plan_entries = _normalize_plan_entries(raw_plan)
        # Dedup within and across widgets.
        plan_entries = _dedup_plan(plan_entries)

        # Degraded mode: keyword preset. If not even that matches, fail
        # visibly — an arbitrary widget erodes trust more than an error.
        used_fallback = False
        if not plan_entries:
            fallback_ops = self._fallback_plan(input.intent, reg)
            if not fallback_ops:
                write_event(doc.session_id, "proposal.health", {
                    "stage": "fallback", "event": "proposal_failed",
                })
                raise _ProposalFailed(
                    "couldn't compose widgets for this prompt — try rephrasing"
                )
            write_event(doc.session_id, "proposal.health", {
                "stage": "fallback", "event": "fallback_keyword_hit",
            })
            used_fallback = True
            plan_entries = [{
                "widget_name": None, "category": None,
                "ops": [{"op_id": op["op_id"], "rationale": "",
                         "starting_params": op.get("starting_params")} for op in fallback_ops],
            }]

        # Phase 2: resolve the WHOLE stack in one call so the model can
        # budget overlapping ops (exposure + shadows) instead of each op
        # independently applying a full-strength fix. The wait_for guards
        # the per-session write lock the tool registry holds around this
        # handler (H19 audit deadlock): the SDK timeout bounds each attempt
        # and the resolver retries once, so 2× + margin covers the worst case.
        #
        # The keyword fallback skips the resolver: its preset params are
        # curated values already, and if the planner just failed on an
        # unhealthy API, two more timeout-length attempts would park the
        # per-session lock for nothing. The build loop below ships the
        # clamped preset priors directly.
        by_entry: dict[int, list[tuple[str, dict]]] = {}
        if not used_fallback:
            from app.config import get_app_config
            stack_timeout_s = get_app_config().runtime.anthropic_timeout_s * 2 + 5
            try:
                by_entry = await asyncio.wait_for(
                    asyncio.to_thread(
                        anthropic.resolve_stack_params,
                        plan_entries=plan_entries,
                        intent=input.intent,
                        image_context=image_context,
                        registry=reg,
                        session_id=doc.session_id,
                    ),
                    timeout=stack_timeout_s,
                )
            except Exception as exc:  # noqa: BLE001 — includes TimeoutError
                write_event(doc.session_id, "proposal.health", {
                    "stage": "resolve", "event": "resolver_failed", "detail": str(exc)[:500],
                })
                raise _ProposalFailed(
                    "couldn't resolve adjustment values for this prompt — try again"
                ) from exc

        # Prefer scope-supplied layer ids (image_node-rooted scope), fall back
        # to the explicit input.layer_ids the client shipped for non-image-node
        # scopes (toolrail / pin with a global or mask scope).
        image_node_layer_ids = (
            list(scope.root.layer_ids) if scope.root.kind == "image_node"
            else (list(input.layer_ids) if input.layer_ids else None)
        )
        origin = WidgetOrigin(
            kind=input.origin, prompt=input.prompt or input.intent,
            parent_widget_id=None,
        )

        from app.services.anthropic_client import clamp_op_params

        widgets: list[Widget] = []
        for entry_index, entry in enumerate(plan_entries):
            resolved_for_entry = dict(by_entry.get(entry_index, []))
            # Walk the PLAN's ops (not the response's) so plan order is kept
            # and an op the model omitted still ships, with its planner
            # priors clamped to schema instead of silently vanishing.
            ops_for_entry: list[tuple[str, dict]] = []
            for op_entry in entry["ops"]:
                op_id = op_entry.get("op_id")
                if op_id not in reg.ops:
                    continue
                params = resolved_for_entry.get(op_id)
                if params is None:
                    params = clamp_op_params(
                        reg.ops[op_id], op_entry.get("starting_params") or {},
                    )
                ops_for_entry.append((op_id, params))
            if not ops_for_entry:
                continue   # nothing valid planned for this entry
            widget = _build_widget_multi(
                widget_name=entry.get("widget_name"),
                category=entry.get("category"),
                ops=ops_for_entry,
                intent=input.intent,
                scope=scope,
                origin=origin,
                layer_id=input.layer_id,
                image_node_layer_ids=image_node_layer_ids,
                doc=doc,
            )
            _attach_fused_compound(widget, doc, entry.get("driver_label"))
            doc.add_widget(widget)
            widgets.append(widget)

        return _Output(widgets=[w.model_dump(mode="json", by_alias=True) for w in widgets])

    def _fallback_plan(self, intent: str, registry) -> list[dict]:
        """Keyword match intent to a preset. No match → empty: the caller
        raises _ProposalFailed rather than spawning an arbitrary preset
        (the old "first preset in dict order" branch actively eroded trust)."""
        lower = intent.lower()
        for preset_id, preset in registry.presets.items():
            if preset_id in lower or any(tag in lower for tag in preset.semantic_tags):
                return [{"op_id": p.op_id, "starting_params": p.params}
                        for p in preset.ops]
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
        elif input.layer_ids:
            image_node_layer_ids = list(input.layer_ids)

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
                doc=doc,
            )
            doc.add_widget(widget)
            widgets.append(widget)

        return _Output(widgets=[w.model_dump(mode="json", by_alias=True) for w in widgets])

    def _handle_filter_spawn(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        """Build a LUT widget without touching the registry.

        Filter/LUT presets are managed client-side via LutRegistry — the
        backend just produces the widget shell (one lut node + an
        intensity slider). This is the only forced_ops member that's not
        a registry op. If filter ever moves into the registry, this
        carve-out can fold into the normal _handle_tool_invoked path.
        """
        widget_id = f"w_{uuid.uuid4().hex[:8]}"

        image_node_layer_ids: list[str] | None = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)
        elif input.layer_ids:
            image_node_layer_ids = list(input.layer_ids)
        layer_id_for_node = (
            image_node_layer_ids[0] if image_node_layer_ids else input.layer_id
        )

        node_id = f"n_{uuid.uuid4().hex[:6]}"
        node = WidgetNode(
            id=node_id,
            type="lut",
            params={"intensity": 1.0},
            scope=scope,
            inputs=[],
            widget_id=widget_id,
            layer_id=layer_id_for_node,
            layer_ids=image_node_layer_ids,
        )

        binding = ControlBinding(
            param_key="intensity",
            label="Intensity",
            control_type="slider",
            control_schema=ControlSchema.model_validate({
                "control_type": "slider", "min": 0, "max": 1, "step": 0.01,
            }),
            value=1.0,
            default=1.0,
            target=NodeParamTarget(node_id=node_id, param_key="intensity"),
        )

        widget = Widget(
            id=widget_id,
            intent=input.intent,
            scope=scope,
            origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
            op_id="filter",
            composed=False,
            nodes=[node],
            bindings=[binding],
            preview=WidgetPreview(kind="none", auto_before_after=False),
            rejected_attempts=[],
            status="active",
            revision=1,
        )
        doc.add_widget(widget)
        return _Output(widgets=[widget.model_dump(mode="json", by_alias=True)])

    def _handle_tool_invoked(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        if not input.forced_ops:
            raise ValueError("tool_invoked origin requires forced_ops")

        # Filter/LUT is intentionally outside the registry (presets live
        # client-side via LutRegistry). Route the single-op `filter` case
        # to its own builder. Mixed lists are explicitly rejected.
        if "filter" in input.forced_ops:
            if input.forced_ops != ["filter"]:
                raise ValueError(
                    "forced_ops with 'filter' must contain only 'filter' — "
                    "the LUT path is single-op."
                )
            return self._handle_filter_spawn(doc, input, scope)

        reg = get_registry()

        image_node_layer_ids = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)
        elif input.layer_ids:
            image_node_layer_ids = list(input.layer_ids)

        origin = WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None)
        forced_params = input.forced_params or {}
        widgets: list[Widget] = []
        for op_id in input.forced_ops:
            if op_id not in reg.ops:
                raise ValueError(f"unknown op id: {op_id!r}")
            # forced_params provides per-op initial values (auto-tune path).
            # Keys not present in the op fall back to registry defaults via
            # _build_widget's param-merge.
            op_params = forced_params.get(op_id, {})
            widget = _build_widget(
                op_id=op_id, params=op_params, intent=input.intent, scope=scope,
                origin=origin, layer_id=input.layer_id,
                image_node_layer_ids=image_node_layer_ids,
                doc=doc,
            )
            doc.add_widget(widget)
            widgets.append(widget)

        return _Output(widgets=[w.model_dump(mode="json", by_alias=True) for w in widgets])
