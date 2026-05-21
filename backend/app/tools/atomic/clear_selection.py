from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(BaseModel):
    ok: bool


class ClearSelectionTool(BackendTool[_Input, _Output]):
    name = "clear_selection"
    kind = "mutate"
    description = "Discard the currently armed selection. Call between unrelated operations."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.active_mask_id = None
        doc.committed_mask_id = None
        doc.emit_selection_changed(None, "none", None)
        return _Output(ok=True)
