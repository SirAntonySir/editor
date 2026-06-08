"""Clear a per-binding user lock. The companion to the implicit lock-on-edit
behaviour in `set_widget_param`: once a compound bundle key (e.g.
`kelvin.kelvin`) has been hand-edited, dial drags skip it. Calling this tool
removes the lock and — for compound-bundle widgets — immediately restores the
dial-derived value so the visual state matches the position without requiring
the user to nudge the dial."""
from __future__ import annotations

from pydantic import BaseModel

from app.registry.loader import get_registry
from app.registry.schema import RegistryOp
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


def _get_compound_op(op_id: str | None) -> RegistryOp | None:
    """Return the registry op if it has a compound block, else None."""
    if not op_id:
        return None
    op = get_registry().ops.get(op_id)
    if op is None or op.compound is None:
        return None
    return op


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str
    param_key: str


class _Output(BaseModel):
    ok: bool


class UnlockWidgetParamTool(BackendTool[_Input, _Output]):
    name = "unlock_widget_param"
    kind = "mutate"
    description = (
        "Clear a per-binding user lock previously created by manual edits via "
        "set_widget_param. For Time-of-Day bundle keys, also restores the "
        "dial-derived value at the current position. REST-only — locks are a "
        "human-affordance concept."
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

        # Idempotent unlock.
        if input.param_key in w.locked_params:
            w.locked_params = [k for k in w.locked_params if k != input.param_key]

        # Compound ops: restore the dial-derived value at the current position
        # so the canvas reflects the unlock immediately. Skip the driver key
        # itself (it has no derived value — it IS the derivation input).
        op = _get_compound_op(w.op_id)
        if op is not None and input.param_key != op.compound.driver:  # type: ignore[union-attr]
            from app.registry.interpolate import interpolate_1d

            driver_key = op.compound.driver  # type: ignore[union-attr]
            position_binding = next(
                (b for b in w.bindings if b.param_key == driver_key), None,
            )
            if position_binding is not None:
                position = float(position_binding.value)
                bundle = interpolate_1d(op.compound.anchors, position)  # type: ignore[union-attr]
                if input.param_key in bundle:
                    bvalue = bundle[input.param_key]
                    binding = next(
                        (b for b in w.bindings if b.param_key == input.param_key), None,
                    )
                    if binding is not None:
                        binding.value = bvalue
                        node = next(
                            (n for n in w.nodes if n.id == binding.target.node_id), None,
                        )
                        if node is not None:
                            node.params[binding.target.param_key] = bvalue
                            doc.set_param(
                                node.layer_id, node.type,
                                binding.target.param_key, bvalue,
                            )

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
