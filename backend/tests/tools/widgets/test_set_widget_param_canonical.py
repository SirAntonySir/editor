from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.tools.widgets.propose_widget import ProposeWidgetTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    for t in (SetWidgetParamTool(), ProposeWidgetTool()):
        if t.name not in reg._tools:
            reg.register(t)
    return TestClient(app)


def _session_with_context(client) -> str:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_set_widget_param_writes_canonical():
    client = _client()
    sid = _session_with_context(client)
    w = client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": "Light", "scope": {"kind": "global"}, "op_id": "light",
        "layer_id": "layer_a", "origin": "tool_invoked",
    }}).json()["output"]["widget"]
    client.post("/api/tools/set_widget_param", json={"session_id": sid, "input": {
        "widget_id": w["id"], "param_key": "exposure", "value": 70,
    }})
    doc = deps.get_session_store().get_document(sid)
    assert doc.canonical["layer_a"]["basic"]["exposure"] == 70
