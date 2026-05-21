import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_fused_tools import ListFusedToolsTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "list_fused_tools" not in reg._tools:
        reg.register(ListFusedToolsTool())
    yield TestClient(app)


def test_list_fused_tools_returns_catalog(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/list_fused_tools",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    ids = {t["id"] for t in body["output"]["tools"]}
    assert "warm_grade" in ids
    assert len(ids) == 9  # All 9 fused tools shipped
    entry = next(t for t in body["output"]["tools"] if t["id"] == "warm_grade")
    assert entry["param_envelope"]["temperature"]["min"] == -1200
