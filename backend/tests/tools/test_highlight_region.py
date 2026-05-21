import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.highlight_region import HighlightRegionTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "highlight_region" not in reg._tools:
        reg.register(HighlightRegionTool())
    yield TestClient(app)


def test_highlight_arms_active_mask(client, sample_image_context) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_subject"] = MaskRecord(
        id="m_subject", width=1, height=1, png_b64="aGVsbG8=",
        source="named_region", label="subject",
    )
    body = client.post(
        "/api/tools/highlight_region",
        json={"session_id": sid, "input": {"label": "subject", "reasoning": "look here"}},
    ).json()
    assert body["ok"] is True
    assert doc.active_mask_id == "m_subject"
