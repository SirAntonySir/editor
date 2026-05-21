import base64

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.select_named_region import SelectNamedRegionTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "select_named_region" not in reg._tools:
        reg.register(SelectNamedRegionTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_select_unknown_region_returns_envelope_error(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    body = client.post(
        "/api/tools/select_named_region",
        json={"session_id": sid, "input": {"label": "spaceship", "commit": True}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unknown_region"


def test_select_region_without_mask_returns_scope_unresolvable(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    body = client.post(
        "/api/tools/select_named_region",
        json={"session_id": sid, "input": {"label": "subject", "commit": True}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "scope_unresolvable"


def test_select_region_with_mask_arms_and_commits(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_subject"] = MaskRecord(
        id="m_subject", width=10, height=10,
        png_b64=base64.b64encode(b"\x00" * 10).decode(),
        source="named_region", label="subject",
    )
    body = client.post(
        "/api/tools/select_named_region",
        json={"session_id": sid, "input": {"label": "subject", "commit": True}},
    ).json()
    assert body["ok"] is True
    assert doc.committed_mask_id == "m_subject"
    assert doc.active_mask_id is None
