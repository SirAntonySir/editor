from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _UnknownBinding(KeyError):
    pass


class _OrphanBinding(KeyError):
    """The binding points at a node that no longer exists on the widget.
    Mapped to `orphan_binding` in the envelope so the FE can surface a
    specific error rather than the value silently failing to round-trip
    through the op_graph projection."""
    pass


class _WidgetDismissed(ValueError):
    """The widget is closed (dismissed) — a param edit on it means the
    caller's view of the session has diverged (e.g. a stale frontend
    snapshot after a broken SSE stream, still rendering the widget).
    Silently accepting the write would bump node params + canonical on a
    ghost; failing loudly lets the client surface the error and resync."""
    pass


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str
    param_key: str
    value: float | int | str | bool | list | dict


class _Output(BaseModel):
    ok: bool


class SetWidgetParamTool(BackendTool[_Input, _Output]):
    name = "set_widget_param"
    kind = "mutate"
    description = (
        "Set a single binding's value on a widget. REST-only — slider-dragging "
        "is a human pointing-device action, not an agent action."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )
    is_user_action = True

    def coalesce_key(self, input: _Input) -> str:  # noqa: A002
        """Merge consecutive set_widget_param calls on the SAME (widget, param)
        into one undo entry, mirroring set_param's coalescing strategy so that
        widget slider drags also collapse to a single undoable step."""
        return f"set_widget_param:{input.widget_id}:{input.param_key}"

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        from app.tools.widgets.set_param import _format_value
        return f"Setting {input.param_key} = {_format_value(input.value)}"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Note on concurrency: this tool is `kind = "mutate"`, so the
        # registry runs it under `with_document_lock(session_id)`
        # (tools/registry.py:117). Two concurrent set_widget_param calls
        # on the same session therefore serialise — the audit's "race +
        # lost-update on locked_params" framing doesn't apply. The bug
        # this handler closes is the divergence one: if a binding points
        # at a node that no longer exists on the widget (e.g. a future
        # tool clears the node without dropping the binding), the
        # binding.value would update but the canonical write would
        # silently skip, leaving widget and op_graph drifting apart. We
        # raise `_OrphanBinding` BEFORE touching any state.
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        if w.status == "dismissed":
            raise _WidgetDismissed(
                f"widget {input.widget_id!r} is dismissed — cannot edit its params"
            )
        # Fused intent widget driver: '__driver' has no binding — it drives
        # the widget-local compound block. Interpolate/extrapolate the anchor
        # table, clamp per registry param range, and write every UNLOCKED
        # derived key to its node + canonical + binding. Locked params keep
        # the user's hand-set value.
        if w.compound is not None and input.param_key == w.compound.driver:
            from app.registry.interpolate import interpolate_extended
            from app.registry.loader import get_registry
            from app.tools.widgets.fused_compound import DRIVER_MAX

            reg = get_registry()
            t = max(0.0, min(DRIVER_MAX, float(input.value)))
            derived = interpolate_extended(
                w.compound.anchors, t, mode=w.compound.interpolation or "catmull_rom_1d",
            )
            locked = set(w.locked_params)
            for qkey, raw_val in derived.items():
                node_id, _, pkey = qkey.partition(":")
                d_node = next((n for n in w.nodes if n.id == node_id), None)
                if d_node is None:
                    continue
                d_binding = next(
                    (b for b in w.bindings
                     if b.target.node_id == node_id and b.target.param_key == pkey),
                    None,
                )
                if d_binding is not None and d_binding.param_key in locked:
                    continue
                val = float(raw_val)
                d_op = reg.ops.get(d_node.op_id or "")
                d_param = d_op.params.get(pkey) if d_op is not None else None
                if d_param is not None and d_param.range is not None:
                    lo, hi = d_param.range
                    val = max(lo, min(hi, val))
                d_node.params[pkey] = val
                d_layers = (
                    d_node.layer_ids if d_node.layer_ids is not None
                    else [d_node.layer_id]
                )
                for layer in d_layers:
                    doc.set_param(layer, d_node.type, pkey, val)
                if d_binding is not None:
                    d_binding.value = val
            w.driver_value = t
            w.revision += 1
            doc.update_widget(w)
            return _Output(ok=True)

        binding = next((b for b in w.bindings if b.param_key == input.param_key), None)
        if binding is None:
            raise _UnknownBinding(input.param_key)
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is None:
            raise _OrphanBinding(
                f"binding {input.param_key!r} on widget {input.widget_id!r} "
                f"points at node {binding.target.node_id!r}, which is no longer "
                f"on the widget — widget needs cleanup"
            )

        binding.value = input.value
        node.params[binding.target.param_key] = input.value
        # Canonical write: the op_graph now projects from here. Replicate widgets
        # carry layer_ids — write to every target layer, not just the anchor.
        target_layers = node.layer_ids if node.layer_ids is not None else [node.layer_id]
        for layer in target_layers:
            doc.set_param(layer, node.type, binding.target.param_key, input.value)

        # Fused intent widget: any derived-key edit implicit-locks so the
        # driver stops moving it. ('__driver' itself returned early above.)
        if w.compound is not None:
            if input.param_key not in w.locked_params:
                w.locked_params.append(input.param_key)

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
