import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_layers import ListLayersTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "list_layers" not in reg._tools:
        reg.register(ListLayersTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_list_layers_returns_one_image_layer(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/list_layers",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert len(body["output"]["layers"]) == 1
    assert body["output"]["layers"][0]["type"] == "image"
