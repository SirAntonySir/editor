import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.accept_widget import AcceptWidgetTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "accept_widget" not in reg._tools:
        reg.register(AcceptWidgetTool())
    yield TestClient(app)


def _push_widget(sid: str) -> str:
    from app.schemas.widget import (
        GlobalScope,
        Scope,
        Widget,
        WidgetOrigin,
        WidgetPreview,
    )
    doc = deps.get_session_store().get_document(sid)
    w = Widget(
        id="w_accept_test",
        intent="make it pop",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"),
    )
    doc.add_widget(w)
    return w.id


def test_accept_widget_emits_accepted_event(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    wid = _push_widget(sid)

    body = client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True

    doc = deps.get_session_store().get_document(sid)
    event_kinds = [ev.kind for ev in doc.history]
    assert "widget.accepted" in event_kinds
