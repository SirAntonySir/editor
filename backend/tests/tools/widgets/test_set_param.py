"""Widget-less canonical write tool. The Adjustments accordion edits canonical
directly via `set_param` — no widget required. REST-only (human pointing-device
action), mirroring set_widget_param."""
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.set_param import SetParamTool


def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    if "set_param" not in reg._tools:
        reg.register(SetParamTool())
    return TestClient(app)


def _create_session(client: TestClient) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_set_param_writes_canonical_without_a_widget() -> None:
    client = _client()
    sid = _create_session(client)

    body = client.post(
        "/api/tools/set_param",
        json={"session_id": sid, "input": {
            "layer_id": "layer_a", "op": "basic", "param": "exposure", "value": 55,
        }},
    ).json()
    assert body["ok"] is True

    doc = deps.get_session_store().get_document(sid)
    assert doc.canonical["layer_a"]["basic"]["exposure"] == 55
    # No widget was created.
    assert doc.widgets == {}


def test_set_param_projects_into_op_graph() -> None:
    from app.state.operations import project_to_graph
    client = _client()
    sid = _create_session(client)

    client.post(
        "/api/tools/set_param",
        json={"session_id": sid, "input": {
            "layer_id": "layer_a", "op": "kelvin", "param": "kelvin", "value": 6200,
        }},
    )

    doc = deps.get_session_store().get_document(sid)
    graph = project_to_graph(doc)
    node = next(n for n in graph.nodes if n.id == "canon:layer_a:kelvin")
    assert node.params["kelvin"] == 6200


def test_set_param_emits_canonical_updated_event() -> None:
    client = _client()
    sid = _create_session(client)

    client.post(
        "/api/tools/set_param",
        json={"session_id": sid, "input": {
            "layer_id": "layer_a", "op": "basic", "param": "contrast", "value": -20,
        }},
    )

    doc = deps.get_session_store().get_document(sid)
    kinds = [ev.kind for ev in doc.history]
    assert "canonical.updated" in kinds


def test_set_param_is_rest_only() -> None:
    """Slider/accordion drags are human actions — set_param is not exposed to the LLM."""
    tool = SetParamTool()
    assert tool.permissions.expose_rest is True
    assert tool.permissions.expose_mcp is False
