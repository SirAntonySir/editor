from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _UnknownBinding(KeyError):
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

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        binding = next((b for b in w.bindings if b.param_key == input.param_key), None)
        if binding is None:
            raise _UnknownBinding(input.param_key)
        binding.value = input.value
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is not None:
            node.params[binding.target.param_key] = input.value
            # Canonical write: the op_graph now projects from here.
            doc.set_param(node.layer_id, node.type, binding.target.param_key, input.value)

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
                compound_node = node    # driver's node — bundle lives on the same node
                for bkey, bvalue in derived.items():
                    if compound_node is not None:
                        compound_node.params[bkey] = bvalue
                        doc.set_param(
                            compound_node.layer_id, compound_node.type, bkey, bvalue,
                        )
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
