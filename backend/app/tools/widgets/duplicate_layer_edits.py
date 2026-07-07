from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _LayerPair(BaseModel):
    model_config = camel_config(extra="forbid")
    from_layer_id: str
    to_layer_id: str


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    # One entry per duplicated layer: the source layer and the freshly-created
    # target layer the frontend already added to the new image node.
    mapping: list[_LayerPair] = Field(min_length=1)


class _Output(BaseModel):
    ok: bool


class DuplicateLayerEditsTool(BackendTool[_Input, _Output]):
    name = "duplicate_layer_edits"
    kind = "mutate"
    description = (
        "Clone the pixel-affecting state (canonical adjustments + active "
        "widgets) from each source layer onto its paired target layer. Backs "
        "deep image-node / group Duplicate — REST-only, a human action; the "
        "frontend has already created the target layers + image node."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        return "Duplicate layer edits"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.duplicate_layer_edits(
            [{"from_layer_id": p.from_layer_id, "to_layer_id": p.to_layer_id}
             for p in input.mapping],
        )
        return _Output(ok=True)
