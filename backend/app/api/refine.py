from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.operation_graph import OperationGraph
from app.services.session_store import SessionNotFound, SessionStore
from app.state.operations import project_to_graph

router = APIRouter()


class RefineRequest(BaseModel):
    session_id: str
    prior_graph_id: str
    instruction: str = Field(..., min_length=1, max_length=500)


@router.post("/refine", response_model=OperationGraph, response_model_by_alias=True)
async def refine(
    body: RefineRequest,
    response: Response,
    store: SessionStore = Depends(deps.get_session_store),
) -> OperationGraph:
    """Deprecated shim. Calls refine_widget on every active widget with
    the given instruction. Returns the new projected OperationGraph."""
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "see /api/tools/refine_widget"
    try:
        doc = store.get_document(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    registry = deps.get_tool_registry()
    for wid, w in list(doc.widgets.items()):
        if w.status != "active":
            continue
        envelope = await registry.invoke(
            name="refine_widget",
            session_id=body.session_id,
            raw_input={
                "widget_id": wid,
                "edits": [],
                "additions": [],
                "instruction": body.instruction,
            },
        )
        if not envelope.ok:
            raise HTTPException(
                status_code=502,
                detail=envelope.error.message if envelope.error else "refine failed",
            )
    return project_to_graph(doc)
