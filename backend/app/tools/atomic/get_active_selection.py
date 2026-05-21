from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(BaseModel):
    has_selection: bool
    state: str
    label: str | None = None
    width: int | None = None
    height: int | None = None
    source: str | None = None


class GetActiveSelectionTool(BackendTool[_Input, _Output]):
    name = "get_active_selection"
    kind = "query"
    description = (
        "Inspect the currently armed selection mask. Use this before select_* "
        "tools to avoid clobbering a useful selection."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        mid = doc.active_mask_id or doc.committed_mask_id
        if mid is None or mid not in doc.masks:
            return _Output(has_selection=False, state="none")
        m = doc.masks[mid]
        state = "active" if doc.active_mask_id == mid else "committed"
        return _Output(
            has_selection=True, state=state,
            label=m.label, width=m.width, height=m.height,
            source=m.source,
        )
