from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


def _get_store() -> SessionStore:
    return deps.get_session_store()


def _get_client() -> AnthropicClient:
    return deps.get_anthropic_client()


class RefineRequest(BaseModel):
    session_id: str
    prior_graph_id: str
    instruction: str = Field(..., min_length=1, max_length=500)


@router.post("/refine", response_model=OperationGraph)
async def refine(
    body: RefineRequest,
    store: SessionStore = Depends(_get_store),
    client: AnthropicClient = Depends(_get_client),
) -> OperationGraph:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")

    prior = store.get_graph(body.session_id, body.prior_graph_id)
    if prior is None:
        raise HTTPException(status_code=404, detail="prior graph not found")

    if record.context is None:
        raise HTTPException(status_code=400, detail="session has no image context")
    context = ImageContext.model_validate(record.context)

    try:
        graph = client.generate_refined_panel(
            image_bytes=record.image_bytes,
            mime_type=record.mime_type,
            context=context,
            prior_graph=prior,
            instruction=body.instruction,
            session_id=body.session_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"refine failed: {e}")

    store.store_graph(body.session_id, graph.id, graph.model_dump(mode="json"))
    return graph
