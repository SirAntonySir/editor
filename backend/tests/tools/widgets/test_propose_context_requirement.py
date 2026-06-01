"""Open-on-canvas (tool_invoked) ships defaults and must NOT require analyze_image.
The LLM path still requires image_context. Regression for the silent
'Open on canvas does nothing' bug."""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "propose_widget" not in reg._tools:
        reg.register(ProposeWidgetTool())
    return TestClient(app)


def _session_no_context(client) -> str:
    buf = BytesIO(); Image.new("RGB", (16, 16), (10, 20, 30)).save(buf, format="JPEG")
    return client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]


def test_tool_invoked_open_on_canvas_works_without_context():
    client = _client()
    sid = _session_no_context(client)
    r = client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": "Light", "scope": {"kind": "global"}, "fused_tool_id": "light",
        "layer_id": "layer_a", "origin": "tool_invoked"}})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True, r.json()  # was {ok:false, missing_context}
    doc = deps.get_session_store().get_document(sid)
    assert "basic" in doc.canonical.get("layer_a", {})


def test_hsl_open_on_canvas_works_without_context():
    client = _client()
    sid = _session_no_context(client)
    r = client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": "HSL", "scope": {"kind": "global"}, "fused_tool_id": "hsl",
        "layer_id": "layer_a", "origin": "tool_invoked"}})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True, r.json()


def test_llm_path_still_requires_context():
    client = _client()
    sid = _session_no_context(client)
    r = client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": "warm it up", "scope": {"kind": "global"}, "prompt": "warm it up",
        "layer_id": "layer_a", "origin": "mcp_user_prompt"}})
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "missing_context"
