from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _WidgetDismissed(ValueError):
    """Accepting a dismissed widget means the caller's view has diverged
    (e.g. a stale frontend snapshot after a broken SSE stream, still
    rendering the widget). Fail loudly so the client can surface it and
    resync instead of resurrecting a ghost."""
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

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        return "Accepted widget"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.widget_id not in doc.widgets:
            raise _UnknownWidget(input.widget_id)
        if doc.widgets[input.widget_id].status == "dismissed":
            raise _WidgetDismissed(
                f"widget {input.widget_id!r} is dismissed — cannot accept it"
            )
        doc.accept_widget(input.widget_id)
        return _Output(ok=True)
