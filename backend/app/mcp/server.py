from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.api import deps
from app.mcp.session import MCPSessionNotPaired, MCPSessionRegistry
from app.tools.base import BackendTool
from app.tools.registry import BackendToolRegistry

router = APIRouter()


_session_registry = MCPSessionRegistry()


def get_mcp_session_registry() -> MCPSessionRegistry:
    return _session_registry


_SERVER_NAME = "editor-mcp"
_SERVER_VERSION = "0.1.0"
_PROTOCOL_VERSION = "2025-06-18"


class JSONRPCRequest(BaseModel):
    jsonrpc: str
    id: int | str | None = None
    method: str
    params: dict | None = None


def _jsonrpc_result(req_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _serialise_tool(tool: BackendTool) -> dict:
    description = tool.description
    if tool.usage:
        description = f"{description}\n\nUsage: {tool.usage}"
    return {
        "name": tool.name,
        "description": description,
        "inputSchema": tool.input_schema.model_json_schema(),
    }


@router.post("/mcp")
async def mcp_dispatch(
    req: Request,
    x_editor_session_id: str | None = Header(default=None),
) -> dict:
    try:
        body = JSONRPCRequest.model_validate(await req.json())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid JSON-RPC: {exc}")
    method = body.method
    params = body.params or {}
    req_id = body.id

    if method == "initialize":
        # The wire-level session id is the editor session id we paired with.
        if x_editor_session_id:
            _session_registry.pair(x_editor_session_id, x_editor_session_id)
        return _jsonrpc_result(req_id, {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": _SERVER_NAME, "version": _SERVER_VERSION},
        })

    if method == "tools/list":
        registry: BackendToolRegistry = deps.get_tool_registry()
        tools = [_serialise_tool(t) for t in registry.list_for("mcp")]
        return _jsonrpc_result(req_id, {"tools": tools})

    if method == "tools/call":
        if x_editor_session_id is None:
            return _jsonrpc_error(req_id, -32602, "x-editor-session-id header required")
        try:
            editor_sid = _session_registry.editor_session_id(x_editor_session_id)
        except MCPSessionNotPaired:
            return _jsonrpc_error(req_id, -32602, "MCP session not paired — call initialize first")
        if not deps.get_tool_rate_limiter().try_consume(editor_sid):
            return _jsonrpc_error(req_id, -32000, "rate limited")
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str):
            return _jsonrpc_error(req_id, -32602, "name must be a string")
        registry = deps.get_tool_registry()
        envelope = await registry.invoke(name=name, session_id=editor_sid, raw_input=arguments)
        return _jsonrpc_result(req_id, {
            "content": [{"type": "text", "text": envelope.model_dump_json()}],
            "isError": not envelope.ok,
        })

    if method == "notifications/initialized":
        return _jsonrpc_result(req_id, {})

    return _jsonrpc_error(req_id, -32601, f"method not found: {method}")
