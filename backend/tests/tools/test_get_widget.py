import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.tools.atomic.get_widget import GetWidgetTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "get_widget" not in reg._tools:
        reg.register(GetWidgetTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_get_widget_returns_full_body(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(
        Widget(
            id="w_1", intent="warm",
            scope=Scope.model_validate({"kind": "global"}),
            origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warmer"),
            op_id="warm_grade",
            preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        )
    )
    body = client.post(
        "/api/tools/get_widget",
        json={"session_id": sid, "input": {"widget_id": "w_1"}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["widget"]["id"] == "w_1"


def test_get_widget_unknown_returns_error(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/get_widget",
        json={"session_id": sid, "input": {"widget_id": "missing"}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unknown_widget"
