from __future__ import annotations

import base64

from pydantic import BaseModel, Field

from app.api import deps
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    image_b64: str = Field(min_length=1)
    mime_type: str = Field(min_length=1)


class _Output(BaseModel):
    session_id: str


class CreateSessionTool(BackendTool[_Input, _Output]):
    name = "create_session"
    kind = "query"
    description = "Create a new editor session from a base64-encoded image."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        store = deps.get_session_store()
        img = base64.b64decode(input.image_b64)
        sid = store.create(image_bytes=img, mime_type=input.mime_type)
        return _Output(session_id=sid)
