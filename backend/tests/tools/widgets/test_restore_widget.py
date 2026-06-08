import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.delete_widget import DeleteWidgetTool
from app.tools.widgets.restore_widget import RestoreWidgetTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "delete_widget" not in reg._tools:
        reg.register(DeleteWidgetTool())
    if "restore_widget" not in reg._tools:
        reg.register(RestoreWidgetTool())
    return TestClient(app)


def _setup(client) -> tuple[str, str]:
    from io import BytesIO
    from PIL import Image
    from app.tools.widgets.propose_stack import ProposeStackTool
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    reg = deps.get_tool_registry()
    if "propose_stack" not in reg._tools:
        reg.register(ProposeStackTool())
    proposed = client.post(
        "/api/tools/propose_stack",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"},
            "preset_id": "warm_grade", "origin": "mcp_user_prompt",
        }},
    ).json()
    return sid, proposed["output"]["widgets"][0]["id"]


def test_restore_undismisses_and_revokes_rule(client) -> None:
    sid, wid = _setup(client)
    # First delete with suppress to create a dismissal rule
    client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": True}},
    )
    doc = deps.get_session_store().get_document(sid)
    assert len(doc.dismissals) == 1

    # Now restore
    body = client.post(
        "/api/tools/restore_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "active"
    assert doc.dismissals == []
