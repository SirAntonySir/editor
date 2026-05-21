from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _RegionSummary(BaseModel):
    label: str
    description: str | None = None
    has_mask: bool


class _Output(BaseModel):
    regions: list[_RegionSummary] = Field(default_factory=list)


class _Input(BaseModel):
    pass


class ListNamedRegionsTool(BackendTool[_Input, _Output]):
    name = "list_named_regions"
    kind = "query"
    description = (
        "List the Claude-named regions in the current image. These labels are the "
        "primary vocabulary for select_named_region — prefer them over raw coords."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            return _Output(regions=[])
        mask_labels = {m.label for m in doc.masks.values() if m.label}
        out = []
        for r in ctx.candidate_regions:
            out.append(_RegionSummary(
                label=r.label, description=r.description,
                has_mask=(r.label in mask_labels),
            ))
        return _Output(regions=out)
