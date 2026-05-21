from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.atomic.select_named_region import _ScopeUnresolvable, _UnknownRegion
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    label: str = Field(min_length=1)
    reasoning: str | None = None


class _Output(BaseModel):
    ok: bool
    mask_id: str


class HighlightRegionTool(BackendTool[_Input, _Output]):
    name = "highlight_region"
    kind = "emit"
    description = (
        "Visually point at a region for the user without committing it as a selection. "
        "Use this to draw attention; not to act on."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            raise _ScopeUnresolvable("no image context yet")
        if not any(r.label == input.label for r in ctx.candidate_regions):
            raise _UnknownRegion(input.label)
        mask = next((m for m in doc.masks.values() if m.label == input.label), None)
        if mask is None:
            raise _ScopeUnresolvable(f"region {input.label!r} has no registered mask")
        doc.active_mask_id = mask.id
        doc.emit_selection_changed(mask.id, "active", input.label)
        return _Output(ok=True, mask_id=mask.id)
