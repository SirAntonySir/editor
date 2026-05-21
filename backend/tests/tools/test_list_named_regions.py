import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_named_regions import ListNamedRegionsTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "list_named_regions" not in reg._tools:
        reg.register(ListNamedRegionsTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_empty_without_context(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/list_named_regions",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["regions"] == []


def test_returns_regions_after_context_set(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    body = client.post(
        "/api/tools/list_named_regions",
        json={"session_id": sid, "input": {}},
    ).json()
    labels = [r["label"] for r in body["output"]["regions"]]
    assert labels == ["subject", "sky"]
