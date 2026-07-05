from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str
    op: Literal["add", "remove", "retarget"]
    layer_id: str
    # Required only for `retarget` — the layer being replaced.
    from_layer_id: str | None = None


class _Output(BaseModel):
    ok: bool


class UpdateWidgetTargetsTool(BackendTool[_Input, _Output]):
    name = "update_widget_targets"
    kind = "mutate"
    description = (
        "Add, remove, or retarget a layer in a widget's replicate target set. "
        "Drives connect / reconnect / delete of workspace tethers — REST-only, "
        "a human pointing-device action."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        verb = {"add": "Add", "remove": "Remove", "retarget": "Retarget"}[input.op]
        return f"{verb} widget target {input.layer_id}"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.update_widget_targets(
            widget_id=input.widget_id,
            op=input.op,
            layer_id=input.layer_id,
            from_layer_id=input.from_layer_id,
        )
        return _Output(ok=True)
