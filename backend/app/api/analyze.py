from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.schemas.image_context import ImageContext
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


class AnalyzeRequest(BaseModel):
    session_id: str


def _get_store() -> SessionStore:
    return deps.get_session_store()


def _get_client() -> AnthropicClient:
    return deps.get_anthropic_client()


@router.post("/analyze", response_model=ImageContext)
async def analyze(
    body: AnalyzeRequest,
    store: SessionStore = Depends(_get_store),
    client: AnthropicClient = Depends(_get_client),
) -> ImageContext:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    if record.context is not None:
        return ImageContext.model_validate(record.context)
    context = client.analyze_image(image_bytes=record.image_bytes, mime_type=record.mime_type)
    store.set_context(body.session_id, context.model_dump(mode="json"))
    return context
