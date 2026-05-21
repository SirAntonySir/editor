import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.select_by_box import SelectByBoxTool


class _FakeSam:
    model_name = "fake"

    def embed(self, sid, image_rgb):
        return None

    def decode_box(self, sid, box):
        # Box returns mask filling top-left half
        h = w = 4
        m = np.zeros((h, w), dtype=bool)
        m[:2, :2] = True
        return m


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._sam_client
    deps._sam_client = _FakeSam()
    reg = deps.get_tool_registry()
    if "select_by_box" not in reg._tools:
        reg.register(SelectByBoxTool())
    try:
        yield TestClient(app)
    finally:
        deps._sam_client = _prev


def _make_session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (4, 4), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_select_by_box_creates_sam_box_mask(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/select_by_box",
        json={"session_id": sid, "input": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5, "commit": True}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    mask = doc.masks[doc.committed_mask_id]
    assert mask.source == "sam_box"
