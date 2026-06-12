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


class _Output(BaseModel):
    ok: bool


class AcceptWidgetTool(BackendTool[_Input, _Output]):
    name = "accept_widget"
    kind = "mutate"
    description = "Move an autonomous-suggestion widget from the suggestions tray to active panel."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)
    is_user_action = True

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.widget_id not in doc.widgets:
            raise _UnknownWidget(input.widget_id)
        doc.accept_widget(input.widget_id)
        return _Output(ok=True)
