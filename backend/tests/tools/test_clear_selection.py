import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.clear_selection import ClearSelectionTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "clear_selection" not in reg._tools:
        reg.register(ClearSelectionTool())
    yield TestClient(app)


def test_clear_resets_both_handles(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_1"] = MaskRecord(
        id="m_1", width=1, height=1, png_b64="aGVsbG8=",
        source="sam_point",
    )
    doc.active_mask_id = "m_1"
    doc.committed_mask_id = "m_1"
    body = client.post(
        "/api/tools/clear_selection",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert doc.active_mask_id is None
    assert doc.committed_mask_id is None
