from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.api import deps


def test_agent_turn_runs_loop_and_returns_count():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")

    async def fake_run_agent_turn(**kwargs):
        assert kwargs["sid"] == sid
        assert kwargs["intent"] == "dramatic"
        assert kwargs["attached_objects"] == ["mask_sky"]
        return {"ok": True, "tool_calls": 2}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={"intent": "dramatic", "attached_objects": ["mask_sky"], "client_tools": []},
        )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "tool_calls": 2}


def test_agent_turn_unknown_session_404():
    client = TestClient(app)
    resp = client.post(
        "/api/state/nope/agent_turn",
        json={"intent": "x", "attached_objects": [], "client_tools": []},
    )
    assert resp.status_code == 404
