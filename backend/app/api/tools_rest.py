from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.schemas.errors import ToolResponseEnvelope
from app.tools.registry import BackendToolRegistry

from . import deps

router = APIRouter()


class ToolEnvelope(BaseModel):
    session_id: str
    input: dict


@router.post("/tools/{name}", response_model=ToolResponseEnvelope)
async def invoke_rest(
    name: str,
    body: ToolEnvelope,
    registry: BackendToolRegistry = Depends(deps.get_tool_registry),
) -> ToolResponseEnvelope:
    return await registry.invoke(name=name, session_id=body.session_id, raw_input=body.input)
