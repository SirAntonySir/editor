from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.tools.widgets.propose_stack import ProposeStackTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    for t in (SetWidgetParamTool(), ProposeStackTool()):
        if t.name not in reg._tools:
            reg.register(t)
    return TestClient(app)


def _session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    return sid


def test_set_widget_param_writes_canonical():
    client = _client()
    sid = _session(client)
    w = client.post("/api/tools/propose_stack", json={"session_id": sid, "input": {
        "intent": "Light", "scope": {"kind": "global"}, "forced_ops": ["light"],
        "layer_id": "layer_a", "origin": "tool_invoked",
    }}).json()["output"]["widgets"][0]
    client.post("/api/tools/set_widget_param", json={"session_id": sid, "input": {
        "widget_id": w["id"], "param_key": "exposure", "value": 70,
    }})
    doc = deps.get_session_store().get_document(sid)
    assert doc.canonical["layer_a"]["basic"]["exposure"] == 70
