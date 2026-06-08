from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.propose_stack import ProposeStackTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "propose_stack" not in reg._tools:
        reg.register(ProposeStackTool())
    return TestClient(app)


def _session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    return sid


def test_tool_invoked_seeds_canonical_slot():
    client = _client()
    sid = _session(client)
    client.post("/api/tools/propose_stack", json={"session_id": sid, "input": {
        "intent": "Light", "scope": {"kind": "global"}, "forced_ops": ["light"],
        "layer_id": "layer_a", "origin": "tool_invoked"}})
    doc = deps.get_session_store().get_document(sid)
    assert "basic" in doc.canonical.get("layer_a", {})
    assert "exposure" in doc.canonical["layer_a"]["basic"]
