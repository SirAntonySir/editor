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


# Time-of-Day position key — kept here as a constant so the recompute branch
# is easy to grep against the template.
_TOD_POSITION_KEY = "time_of_day.position"


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

        # Time-of-Day compound-bundle recompute / implicit lock.
        # - Dial drag (`time_of_day.position`): recompute the bundle from the
        #   anchor table and write all non-locked keys through binding + node
        #   params + canonical. Without this the bundle stays at spawn values
        #   and the canvas snaps back when optimistic patches clear on the
        #   revision bump.
        # - Bundle key edit (`kelvin.kelvin`, etc.): implicit lock-on-edit so a
        #   subsequent dial drag won't overwrite the user's value.
        if w.fused_tool_id == "time-of-day":
            from app.tools.fused._time_of_day_data import interpolate_1d

            if input.param_key == _TOD_POSITION_KEY:
                position = float(input.value)
                bundle = interpolate_1d(position)
                # The compound node holds the bundle params alongside `position`.
                # Always the same node that owns the position binding.
                compound_node = node
                for bkey, bvalue in bundle.items():
                    if bkey in w.locked_params:
                        continue
                    if compound_node is not None:
                        compound_node.params[bkey] = bvalue
                        doc.set_param(compound_node.layer_id, compound_node.type, bkey, bvalue)
                    bbind = next((b for b in w.bindings if b.param_key == bkey), None)
                    if bbind is not None:
                        bbind.value = bvalue
            else:
                if input.param_key not in w.locked_params:
                    w.locked_params.append(input.param_key)

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
