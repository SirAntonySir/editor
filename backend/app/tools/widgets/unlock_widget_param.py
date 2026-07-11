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

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)

        # Idempotent unlock.
        if input.param_key in w.locked_params:
            w.locked_params = [k for k in w.locked_params if k != input.param_key]

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
