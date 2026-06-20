"""delete_mask MCP tool — remove a mask from the session's masks_index.

The user dismisses an object via the frontend's right-click → Delete affordance.
This drops the matching MaskRecord from doc.masks and streams a mask.deleted
SSE event so the frontend can filter the entry out of its snapshot.masksIndex
without a full re-fetch.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")

    mask_id: str = Field(min_length=1)


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")

    mask_id: str


class DeleteMaskTool(BackendTool[_Input, _Output]):
    name = "delete_mask"
    kind = "mutate"
    description = (
        "Delete a mask from the session's masks_index. Used when the user "
        "removes a committed segmentation object."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.mask_id not in doc.masks:
            raise ValueError(f"delete_mask: unknown mask_id {input.mask_id!r}")
        doc.remove_mask(input.mask_id)
        return _Output(mask_id=input.mask_id)
