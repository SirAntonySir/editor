from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.propose_stack import ProposeStackTool
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.state.operations import project_to_graph


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    for t in (ProposeStackTool(), SetWidgetParamTool()):
        if t.name not in reg._tools:
            reg.register(t)
    return TestClient(app)


def _session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    return sid


def test_two_basic_widgets_same_layer_share_one_canonical_node():
    """Two tool_invoked 'basic' widgets (Light + Color) on one layer must
    project to ONE basic node whose params are the union — the canonical dedup
    that makes the accordion and canvas share a value."""
    client = _client()
    sid = _session(client)
    for tool in ("light", "color"):
        client.post("/api/tools/propose_stack", json={"session_id": sid, "input": {
            "intent": tool, "scope": {"kind": "global"}, "forced_ops": [tool],
            "layer_id": "layer_a", "origin": "tool_invoked"}})
    doc = deps.get_session_store().get_document(sid)
    graph = project_to_graph(doc)
    basic_nodes = [n for n in graph.nodes if n.layer_id == "layer_a" and n.type == "basic"]
    assert len(basic_nodes) == 1
    keys = set(basic_nodes[0].params)
    assert {"exposure", "saturation"} <= keys
