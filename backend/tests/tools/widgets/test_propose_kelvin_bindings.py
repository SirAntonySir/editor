"""White-balance (kelvin) widget must build with both its bindings — the tint
binding uses control_type `tint_strip`, which must be in the ControlType vocab
or the whole widget fails validation and never reaches the canvas."""

from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_stack import ProposeStackTool


def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    if "propose_stack" not in reg._tools:
        reg.register(ProposeStackTool())
    return TestClient(app)


def _session(client: TestClient) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    return client.post(
        "/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    ).json()["session_id"]


def test_kelvin_widget_builds_with_tint_strip_binding():
    client = _client()
    sid = _session(client)
    resp = client.post("/api/tools/propose_stack", json={"session_id": sid, "input": {
        "intent": "White Balance", "scope": {"kind": "global"},
        "forced_ops": ["kelvin"], "layer_id": "layer_a", "origin": "tool_invoked",
    }}).json()
    assert resp["ok"] is True, resp
    widget = resp["output"]["widgets"][0]
    control_types = {b["controlType"] for b in widget["bindings"]}
    assert control_types == {"kelvin_strip", "tint_strip"}
