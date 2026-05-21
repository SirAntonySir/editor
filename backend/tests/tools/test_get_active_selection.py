import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.get_active_selection import GetActiveSelectionTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "get_active_selection" not in reg._tools:
        reg.register(GetActiveSelectionTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_no_selection_initially(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/get_active_selection",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["has_selection"] is False
    assert body["output"]["state"] == "none"


def test_armed_selection_reported(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_1"] = MaskRecord(
        id="m_1", width=10, height=10, png_b64="x",
        source="sam_point", parent_mask_ids=[], label="subject",
    )
    doc.active_mask_id = "m_1"
    body = client.post(
        "/api/tools/get_active_selection",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["output"]["has_selection"] is True
    assert body["output"]["state"] == "active"
    assert body["output"]["label"] == "subject"
