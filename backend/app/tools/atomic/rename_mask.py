"""rename_mask MCP tool — change the label of an existing mask.

Backs the frontend's inline-rename affordance on the object label chip.
Updates MaskRecord.label in-place on doc.masks and streams a mask.renamed
SSE event so the frontend can patch its snapshot.masksIndex entry without
a full re-fetch.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")

    mask_id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")

    mask_id: str
    label: str


class RenameMaskTool(BackendTool[_Input, _Output]):
    name = "rename_mask"
    kind = "mutate"
    description = (
        "Rename a mask in the session's masks_index. Used when the user "
        "edits an object's label inline on the canvas."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.mask_id not in doc.masks:
            raise ValueError(f"rename_mask: unknown mask_id {input.mask_id!r}")
        doc.rename_mask(input.mask_id, input.label)
        return _Output(mask_id=input.mask_id, label=input.label)
