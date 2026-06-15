from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownRegion(KeyError):
    """Mapped to unknown_region in the envelope by the registry."""


class _ScopeUnresolvable(KeyError):
    """Mapped to scope_unresolvable."""


class _Input(BaseModel):
    label: str = Field(min_length=1)
    commit: bool = True


class _Output(BaseModel):
    ok: bool
    state: str  # "active" | "committed"
    mask_id: str


class SelectNamedRegionTool(BackendTool[_Input, _Output]):
    name = "select_named_region"
    kind = "mutate"
    description = (
        "Arm a Claude-named region as the active selection. Prefer this over raw "
        "coordinate-based segmentation when a named region covers the goal."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.get_image_context("in-default")
        if ctx is None:
            raise _ScopeUnresolvable("no image context yet")
        region = next((r for r in ctx.candidate_regions if r.label == input.label), None)
        if region is None:
            raise _UnknownRegion(f"no region named {input.label!r}")
        mask = next((m for m in doc.masks.values() if m.label == input.label), None)
        if mask is None:
            raise _ScopeUnresolvable(
                f"region {input.label!r} has no registered mask; "
                "call select_by_point or seed via /analyze pre-segmentation"
            )
        if input.commit:
            doc.active_mask_id = None
            doc.committed_mask_id = mask.id
            state = "committed"
        else:
            doc.active_mask_id = mask.id
            state = "active"
        doc.emit_selection_changed(mask.id, state, input.label)
        return _Output(ok=True, state=state, mask_id=mask.id)
