"""MCP create_session tool — base64 equivalent of REST ``POST /api/session``.

Shares the inbound-image validation (size + MIME) with the REST path via
:func:`app.services.image_validation.validate_image_upload`; without that
guard an MCP client could mint sessions above ``max_image_bytes`` or with
arbitrary content types, while the REST surface enforced both. See the
header of ``app/api/session.py`` for the full responsibility map across
the four ``session*`` modules.
"""

from __future__ import annotations

import base64

from pydantic import BaseModel, Field

from app.api import deps
from app.services.image_validation import ImageValidationError, validate_image_upload
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
        try:
            img = base64.b64decode(input.image_b64, validate=True)
        except (ValueError, base64.binascii.Error) as exc:
            raise ValueError(f"invalid base64 image: {exc}") from exc
        # Surfaces the same 413 / 415 checks the REST entry point enforces; the
        # ValueError propagates to the tool registry which encodes it into the
        # envelope's `error.message`.
        try:
            validated = validate_image_upload(img, input.mime_type)
        except ImageValidationError as exc:
            raise ValueError(str(exc)) from exc
        store = deps.get_session_store()
        sid = store.create(
            image_bytes=validated.image_bytes,
            mime_type=validated.mime_type,
        )
        return _Output(session_id=sid)
