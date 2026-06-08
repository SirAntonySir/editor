import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.tools.atomic.list_widgets import ListWidgetsTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "list_widgets" not in reg._tools:
        reg.register(ListWidgetsTool())
    yield TestClient(app)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def _push_widget(doc, wid: str) -> None:
    doc.add_widget(
        Widget(
            id=wid, intent=f"intent-{wid}",
            scope=Scope.model_validate({"kind": "global"}),
            origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"),
            op_id="warm_grade",
            preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        )
    )


def test_list_widgets_empty(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/list_widgets",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["widgets"] == []


def test_list_widgets_returns_summaries(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    _push_widget(doc, "w_1")
    _push_widget(doc, "w_2")
    body = client.post(
        "/api/tools/list_widgets",
        json={"session_id": sid, "input": {}},
    ).json()
    ids = [w["id"] for w in body["output"]["widgets"]]
    assert ids == ["w_1", "w_2"]
    assert {"id", "intent", "scope", "status", "revision", "origin_kind"} <= set(body["output"]["widgets"][0])
