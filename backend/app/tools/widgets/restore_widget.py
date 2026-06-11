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


class RestoreWidgetTool(BackendTool[_Input, _Output]):
    name = "restore_widget"
    kind = "mutate"
    description = "Un-dismiss a widget. Revokes any dismissal rule the delete created."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.widget_id not in doc.widgets:
            raise _UnknownWidget(input.widget_id)
        doc.restore_widget(input.widget_id)
        return _Output(ok=True)
