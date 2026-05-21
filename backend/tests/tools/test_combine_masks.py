import base64
from io import BytesIO

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.combine_masks import CombineMasksTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "combine_masks" not in reg._tools:
        reg.register(CombineMasksTool())
    yield TestClient(app)


def _make_session(client) -> str:
    buf = BytesIO()
    Image.new("RGB", (4, 4), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def _png_b64_from_array(arr: np.ndarray) -> str:
    img = Image.fromarray((arr * 255).astype("uint8"), mode="L")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_union_combines_two_masks(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    a = np.zeros((4, 4), dtype=bool)
    a[0, 0] = True
    b = np.zeros((4, 4), dtype=bool)
    b[3, 3] = True
    doc.masks["a"] = MaskRecord(id="a", width=4, height=4, png_b64=_png_b64_from_array(a), source="sam_point")
    doc.masks["b"] = MaskRecord(id="b", width=4, height=4, png_b64=_png_b64_from_array(b), source="sam_point")
    body = client.post(
        "/api/tools/combine_masks",
        json={"session_id": sid, "input": {"op": "union", "a": "a", "b": "b"}},
    ).json()
    assert body["ok"] is True
    new_id = body["output"]["mask_id"]
    assert new_id in doc.masks
    assert doc.masks[new_id].source == "combined"
    assert doc.masks[new_id].parent_mask_ids == ["a", "b"]
