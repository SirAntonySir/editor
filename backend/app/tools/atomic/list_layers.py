from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _LayerSummary(BaseModel):
    id: str
    type: str
    name: str
    is_active: bool
    adjustment_count: int


class _Output(BaseModel):
    layers: list[_LayerSummary] = Field(default_factory=list)


class ListLayersTool(BackendTool[_Input, _Output]):
    name = "list_layers"
    kind = "query"
    description = (
        "List the layers in the current document. Most documents have a single "
        "image layer."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        return _Output(layers=[
            _LayerSummary(
                id="l_image", type="image", name="Background",
                is_active=True,
                adjustment_count=sum(1 for w in doc.widgets.values() if w.status == "active"),
            )
        ])
