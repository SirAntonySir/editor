from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _WidgetSummary(BaseModel):
    id: str
    intent: str
    scope: dict
    status: str
    revision: int
    origin_kind: str


class _Output(BaseModel):
    widgets: list[_WidgetSummary] = Field(default_factory=list)


class ListWidgetsTool(BackendTool[_Input, _Output]):
    name = "list_widgets"
    kind = "query"
    description = "List all widgets on the document (active + dismissed)."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        out = []
        for wid in doc.widget_order:
            w = doc.widgets[wid]
            out.append(_WidgetSummary(
                id=w.id, intent=w.intent,
                scope=w.scope.model_dump(mode="json"),
                status=w.status, revision=w.revision,
                origin_kind=w.origin.kind,
            ))
        return _Output(widgets=out)
