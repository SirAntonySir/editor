from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps  # import module so monkeypatch.setattr(deps, ...) is honoured at request time

router = APIRouter()


def _get_store() -> SessionStore:
    return deps.get_session_store()


def _get_client() -> AnthropicClient:
    return deps.get_anthropic_client()


class PanelRequest(BaseModel):
    session_id: str
    user_goal: str


@router.post("/panel", response_model=OperationGraph)
async def panel(
    body: PanelRequest,
    store: SessionStore = Depends(_get_store),
    client: AnthropicClient = Depends(_get_client),
) -> OperationGraph:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    if record.context is None:
        context = client.analyze_image(
            image_bytes=record.image_bytes,
            mime_type=record.mime_type,
            session_id=body.session_id,
        )
        store.set_context(body.session_id, context.model_dump(mode="json"))
    else:
        context = ImageContext.model_validate(record.context)
    return client.generate_panel(
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
        context=context,
        user_goal=body.user_goal,
        session_id=body.session_id,
    )
