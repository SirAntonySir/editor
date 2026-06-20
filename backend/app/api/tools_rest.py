from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.mcp.rate_limit import RateLimiter
from app.schemas.errors import ToolResponseEnvelope
from app.tools.registry import BackendToolRegistry

from . import deps

router = APIRouter()


class ToolEnvelope(BaseModel):
    session_id: str
    input: dict


@router.post("/tools/{name}", response_model=ToolResponseEnvelope, response_model_by_alias=True)
async def invoke_rest(
    name: str,
    body: ToolEnvelope,
    registry: BackendToolRegistry = Depends(deps.get_tool_registry),
    rate_limiter: RateLimiter = Depends(deps.get_tool_rate_limiter),
) -> ToolResponseEnvelope:
    # Share the per-session bucket with the MCP path so a client can't
    # multiply throughput by hitting both surfaces in parallel.
    if not rate_limiter.try_consume(body.session_id):
        raise HTTPException(status_code=429, detail="rate limited")
    return await registry.invoke(name=name, session_id=body.session_id, raw_input=body.input)
