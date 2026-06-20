from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    """Mapped to unknown_widget in the envelope by the registry."""
    pass


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str


class _Output(BaseModel):
    widget: dict


class GetWidgetTool(BackendTool[_Input, _Output]):
    name = "get_widget"
    kind = "query"
    description = "Return the full body of one widget by id."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        return _Output(widget=w.model_dump(mode="json", by_alias=True))
