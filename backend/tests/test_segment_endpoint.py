import base64
from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_sam_client, get_session_store
from app.main import app
from app.services.session_store import SessionStore


@pytest.fixture
def client_with_session():
    """Provides a TestClient, a SessionStore with one fake session, and a mock SamClient."""
    store = SessionStore(ttl_seconds=3600)
    from PIL import Image
    import io
    img = Image.new("RGB", (4, 4), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    sid = store.create(image_bytes=buf.getvalue(), mime_type="image/png")

    sam = MagicMock()
    sam.model_name = "vit_b"
    sam.decode_point.return_value = np.array([
        [True, True, False, False],
        [True, True, False, False],
        [False, False, False, False],
        [False, False, False, False],
    ])
    sam.decode_box.return_value = np.ones((4, 4), dtype=bool)

    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_sam_client] = lambda: sam
    yield TestClient(app), sid, sam
    app.dependency_overrides.clear()


def test_embed_endpoint_calls_sam_embed(client_with_session):
    client, sid, sam = client_with_session
    res = client.post("/api/segment/embed", json={"session_id": sid})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    sam.embed.assert_called_once()
    args = sam.embed.call_args.args
    assert args[0] == sid
    assert hasattr(args[1], "shape")


def test_embed_returns_404_for_unknown_session(client_with_session):
    client, _, _ = client_with_session
    res = client.post("/api/segment/embed", json={"session_id": "missing"})
    assert res.status_code == 404


def test_decode_point_returns_png(client_with_session):
    client, sid, sam = client_with_session
    res = client.post("/api/segment/decode", json={
        "session_id": sid,
        "prompts": [{"kind": "point", "data": [1.0, 1.0, 1]}],
    })
    assert res.status_code == 200
    body = res.json()
    assert body["width"] == 4
    assert body["height"] == 4
    assert body["model"].startswith("sam-")
    raw = base64.b64decode(body["mask_png_base64"])
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


def test_decode_box_uses_decode_box(client_with_session):
    client, sid, sam = client_with_session
    res = client.post("/api/segment/decode", json={
        "session_id": sid,
        "prompts": [{"kind": "box", "data": [0.0, 0.0, 4.0, 4.0]}],
    })
    assert res.status_code == 200
    sam.decode_box.assert_called_once()
    sam.decode_point.assert_not_called()
