from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _UnknownBinding(KeyError):
    pass


class _Input(BaseModel):
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
        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
