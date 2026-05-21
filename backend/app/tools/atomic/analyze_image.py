from __future__ import annotations

from pydantic import BaseModel

from app.api import deps
from app.schemas.image_context import ImageContext
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(ImageContext):
    pass


class AnalyzeImageTool(BackendTool[_Input, _Output]):
    name = "analyze_image"
    kind = "mutate"
    description = (
        "Run image analysis (cached). Returns the ImageContext (subjects, "
        "lighting, mood, dominant tones, regions). Plan 2 extends this with "
        "the autonomous-suggestion pass."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if doc.image_context is not None:
            return _Output.model_validate(doc.image_context.model_dump(mode="json"))
        client = deps.get_anthropic_client()
        ctx = client.analyze_image(
            image_bytes=doc.image_bytes,
            mime_type=doc.mime_type,
            session_id=doc.session_id,
        )
        doc.image_context = ctx
        return _Output.model_validate(ctx.model_dump(mode="json"))
