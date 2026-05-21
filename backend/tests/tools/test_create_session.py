import base64

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.create_session import CreateSessionTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "create_session" not in reg._tools:
        reg.register(CreateSessionTool())
    yield TestClient(app)


def test_create_session_from_image_b64(client) -> None:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    body = client.post(
        "/api/tools/create_session",
        json={"session_id": "", "input": {"image_b64": b64, "mime_type": "image/jpeg"}},
    ).json()
    assert body["ok"] is True
    sid = body["output"]["session_id"]
    rec = deps.get_session_store().get(sid)
    assert rec.mime_type == "image/jpeg"
