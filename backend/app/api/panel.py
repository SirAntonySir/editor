from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.api import deps
from app.schemas.operation_graph import OperationGraph
from app.services.session_store import SessionNotFound, SessionStore
from app.state.operations import project_to_graph

router = APIRouter()


class PanelRequest(BaseModel):
    session_id: str
    user_goal: str


@router.post("/panel", response_model=OperationGraph)
async def panel(
    body: PanelRequest,
    response: Response,
    store: SessionStore = Depends(deps.get_session_store),
) -> OperationGraph:
    """Deprecated shim. Calls propose_stack(intent=user_goal, scope=global)
    and returns the resulting projected OperationGraph."""
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "see /api/tools/propose_stack"
    registry = deps.get_tool_registry()

    # Ensure context exists — propose_stack LLM path requires it (registry enforces
    # ToolPermissions.requires_context). Call analyze_image first if missing.
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    if record.context is None:
        analyze_envelope = await registry.invoke(
            name="analyze_image", session_id=body.session_id, raw_input={},
        )
        if not analyze_envelope.ok:
            raise HTTPException(
                status_code=502,
                detail=analyze_envelope.error.message if analyze_envelope.error else "analyze failed",
            )

    envelope = await registry.invoke(
        name="propose_stack",
        session_id=body.session_id,
        raw_input={
            "intent": body.user_goal,
            "scope": {"kind": "global"},
            "prompt": body.user_goal,
        },
    )
    if not envelope.ok:
        if envelope.error and envelope.error.code == "missing_session":
            raise HTTPException(status_code=404, detail=envelope.error.message)
        raise HTTPException(
            status_code=502,
            detail=envelope.error.message if envelope.error else "panel failed",
        )
    try:
        doc = store.get_document(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return project_to_graph(doc)
