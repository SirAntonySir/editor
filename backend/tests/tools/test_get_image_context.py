import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.get_image_context import GetImageContextTool


@pytest.fixture
def client():
    from app.main import app
    # GetImageContextTool may already be registered by register_all_atomic_tools.
    # Only register if absent; do not pop on cleanup since other tests rely on it.
    reg = deps.get_tool_registry()
    if "get_image_context" not in reg._tools:
        reg.register(GetImageContextTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_returns_none_context_before_analyze(client) -> None:
    sid = _make_session(client)
    r = client.post(
        "/api/tools/get_image_context",
        json={"session_id": sid, "input": {}},
    )
    body = r.json()
    assert body["ok"] is True
    assert body["output"] == {"available": False, "context": None}


def test_returns_context_after_set(client, sample_image_context) -> None:
    sid = _make_session(client)
    r = client.post(f"/api/session/{sid}/context", json=sample_image_context)
    assert r.status_code == 200
    body = client.post(
        "/api/tools/get_image_context",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["available"] is True
    assert body["output"]["context"]["mood"] == "wintry, intimate"
