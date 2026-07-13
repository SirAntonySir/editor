"""Clear a per-binding user lock. The companion to the implicit lock-on-edit
behaviour in `set_widget_param`: once a param has been hand-edited, driver
drags skip it. Calling this tool removes the lock."""
from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str
    param_key: str


class _Output(BaseModel):
    ok: bool


class UnlockWidgetParamTool(BackendTool[_Input, _Output]):
    name = "unlock_widget_param"
    kind = "mutate"
    description = (
        "Clear a per-binding user lock previously created by manual edits via "
        "set_widget_param. REST-only — locks are a human-affordance concept."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )

    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        return f"Released {input.param_key}"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)

        # Idempotent unlock.
        if input.param_key in w.locked_params:
            w.locked_params = [k for k in w.locked_params if k != input.param_key]

        # SNAP-BACK: releasing a lock on a fused widget must be visible —
        # the param jumps to the value the driver would have given it at its
        # CURRENT position (it "rejoins" the curve), instead of silently
        # waiting for the next driver drag. Params the driver never drove
        # (absent from the anchor table) just unlock; non-fused widgets are
        # untouched.
        if w.compound is not None and w.driver_value is not None:
            from app.registry.interpolate import interpolate_extended
            from app.registry.loader import get_registry

            derived = interpolate_extended(
                w.compound.anchors,
                w.driver_value,
                mode=w.compound.interpolation or "catmull_rom_1d",
            )
            binding = next(
                (b for b in w.bindings if b.param_key == input.param_key), None,
            )
            if binding is not None:
                qkey = f"{binding.target.node_id}:{binding.target.param_key}"
                if qkey in derived:
                    node = next(
                        (n for n in w.nodes if n.id == binding.target.node_id),
                        None,
                    )
                    if node is not None:
                        val = float(derived[qkey])
                        # Clamp per registry range, mirroring the __driver branch.
                        op = get_registry().ops.get(node.op_id or "")
                        param = (
                            op.params.get(binding.target.param_key)
                            if op is not None else None
                        )
                        if param is not None and param.range is not None:
                            lo, hi = param.range
                            val = max(lo, min(hi, val))
                        node.params[binding.target.param_key] = val
                        layers = (
                            node.layer_ids if node.layer_ids is not None
                            else [node.layer_id]
                        )
                        for layer in layers:
                            doc.set_param(
                                layer, node.type, binding.target.param_key, val,
                            )
                        binding.value = val

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
