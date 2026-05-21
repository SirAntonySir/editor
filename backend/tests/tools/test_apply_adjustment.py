import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.apply_adjustment import ApplyAdjustmentTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "apply_adjustment" not in reg._tools:
        reg.register(ApplyAdjustmentTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_apply_adjustment_creates_readonly_widget(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/apply_adjustment",
        json={"session_id": sid, "input": {
            "scope": {"kind": "global"},
            "kind": "kelvin",
            "params": {"temperature": 4800},
            "label": "auto white balance",
        }},
    ).json()
    assert body["ok"] is True
    wid = body["output"]["widget_id"]
    doc = deps.get_session_store().get_document(sid)
    assert wid in doc.widgets
    w = doc.widgets[wid]
    assert w.bindings == []
    assert w.nodes[0].type == "kelvin"
    assert w.nodes[0].params == {"temperature": 4800}
