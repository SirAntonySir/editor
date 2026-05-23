import json

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_initialize_returns_server_info() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Bootstrap an editor session first.
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        r = await ac.post(
            "/mcp",
            headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}},
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["result"]["serverInfo"]["name"] == "editor-mcp"


@pytest.mark.asyncio
async def test_tools_list_returns_registered_tools() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        # initialize
        await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
        )
        r = await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )
        names = {t["name"] for t in r.json()["result"]["tools"]}
        assert "get_image_context" in names
        assert "propose_widget" in names
        # set_widget_param must be REST-only.
        assert "set_widget_param" not in names


@pytest.mark.asyncio
async def test_tools_call_invokes_registry() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
        )
        r = await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                  "params": {"name": "list_widgets", "arguments": {}}},
        )
        result = r.json()["result"]
        assert result["content"][0]["type"] == "text"
        envelope = json.loads(result["content"][0]["text"])
        assert envelope["ok"] is True
        assert envelope["output"]["widgets"] == []
