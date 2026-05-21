import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.select_by_point import SelectByPointTool


class _FakeSam:
    model_name = "fake"

    def embed(self, sid, image_rgb):
        return None

    def decode_point(self, sid, points, labels):
        h = w = 4
        m = np.zeros((h, w), dtype=bool)
        x = int(points[0][0])
        y = int(points[0][1])
        m[max(0, min(h - 1, y)), max(0, min(w - 1, x))] = True
        return m


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._sam_client
    deps._sam_client = _FakeSam()
    reg = deps.get_tool_registry()
    if "select_by_point" not in reg._tools:
        reg.register(SelectByPointTool())
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


def test_select_by_point_creates_mask_record(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/select_by_point",
        json={"session_id": sid, "input": {"x": 0.5, "y": 0.5, "commit": True}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.committed_mask_id is not None
    mask = doc.masks[doc.committed_mask_id]
    assert mask.source == "sam_point"
    assert mask.width == 4 and mask.height == 4
