from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(BaseModel):
    available: bool
    context: dict | None


class GetImageContextTool(BackendTool[_Input, _Output]):
    name = "get_image_context"
    kind = "query"
    description = (
        "Read the cached image analysis (subjects, lighting, mood, dominant tones, "
        "candidate regions). Call this first to understand the photo."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            return _Output(available=False, context=None)
        return _Output(available=True, context=ctx.model_dump(mode="json"))
