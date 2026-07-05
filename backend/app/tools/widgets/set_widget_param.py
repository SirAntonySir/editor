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

        # Compound widget driver-recompute / implicit lock.
        # - Driver param change: recompute the bundle via the registry's anchor
        #   table and write all non-locked derived keys back to the node + canon.
        # - Derived key edit: implicit lock-on-edit so a subsequent driver
        #   change won't overwrite the user's value.
        from app.registry.compound_resolver import resolve_compound
        from app.registry.loader import get_registry

        reg = get_registry()
        op = reg.ops.get(w.op_id) if w.op_id else None
        if op is not None and op.compound is not None:
            if input.param_key == op.compound.driver:
                derived = resolve_compound(w, op, float(input.value))
                # The bundle lives on the same node as the driver — `node`
                # is guaranteed non-None here because we'd have raised
                # `_OrphanBinding` above.
                for bkey, bvalue in derived.items():
                    node.params[bkey] = bvalue
                    for layer in target_layers:
                        doc.set_param(layer, node.type, bkey, bvalue)
                    bbind = next((b for b in w.bindings if b.param_key == bkey), None)
                    if bbind is not None:
                        bbind.value = bvalue
            else:
                # Derived key edit → implicit lock.
                if input.param_key not in w.locked_params:
                    w.locked_params.append(input.param_key)

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
