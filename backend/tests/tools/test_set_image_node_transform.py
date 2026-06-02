"""set_image_node_transform — REST-only upsert of crop/rotate nodes for an
image node. Sending both crop=None and rotate=None removes the entry."""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.tools.atomic.set_image_node_transform import SetImageNodeTransformTool


def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    if "set_image_node_transform" not in reg._tools:
        reg.register(SetImageNodeTransformTool())
    return TestClient(app)


def _new_session(client: TestClient) -> str:
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_upsert_crop_only() -> None:
    client = _client()
    sid = _new_session(client)
    r = client.post("/api/tools/set_image_node_transform", json={
        "session_id": sid, "input": {
            "image_node_id": "in-1",
            "layer_ids": ["layer_a"],
            "crop": {"x": 10, "y": 20, "w": 100, "h": 80},
            "rotate": None,
        },
    })
    assert r.status_code == 200 and r.json()["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.image_node_transforms["in-1"]["crop"] == {"x": 10, "y": 20, "w": 100, "h": 80}
    assert doc.image_node_transforms["in-1"]["rotate"] is None


def test_upsert_rotate_only() -> None:
    client = _client()
    sid = _new_session(client)
    client.post("/api/tools/set_image_node_transform", json={
        "session_id": sid, "input": {
            "image_node_id": "in-1",
            "layer_ids": ["layer_a"],
            "crop": None,
            "rotate": {"angle": 90.0, "flip_h": False, "flip_v": False},
        },
    })
    doc = deps.get_session_store().get_document(sid)
    assert doc.image_node_transforms["in-1"]["rotate"]["angle"] == 90.0


def test_clear_removes_entry_when_both_none() -> None:
    client = _client()
    sid = _new_session(client)
    body = {"session_id": sid, "input": {
        "image_node_id": "in-1", "layer_ids": ["layer_a"],
        "crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "rotate": None,
    }}
    client.post("/api/tools/set_image_node_transform", json=body)
    body["input"]["crop"] = None
    client.post("/api/tools/set_image_node_transform", json=body)
    doc = deps.get_session_store().get_document(sid)
    assert "in-1" not in doc.image_node_transforms
