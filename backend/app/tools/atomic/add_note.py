from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.schemas.widget import Note, NoteAnchor
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    text: str = Field(min_length=1, max_length=512)
    anchor: dict


class _Output(BaseModel):
    note_id: str


class AddNoteTool(BackendTool[_Input, _Output]):
    name = "add_note"
    kind = "emit"
    description = "Anchor a sticky note to the image, a region, or a point."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        nid = f"note_{uuid.uuid4().hex[:8]}"
        note = Note(
            id=nid, text=input.text,
            anchor=NoteAnchor.model_validate(input.anchor),
        )
        doc.emit_note_created(note)
        return _Output(note_id=nid)
