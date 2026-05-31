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
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    doc = deps.get_session_store().get_document(sid)
    wn = WidgetNode(
        id="node_accept_test",
        type="kelvin",
        scope=Scope(root=GlobalScope(kind="global")),
        params={"temperature": 5800},
        widget_id="w_accept_test",
        layer_id="layer_01",
    )
    w = Widget(
        id="w_accept_test",
        intent="make it pop",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"),
        nodes=[wn],
    )
    doc.add_widget(w)
    return w.id


def _create_session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_accept_widget_emits_accepted_event(client) -> None:
    sid = _create_session(client)
    wid = _push_widget(sid)

    body = client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True

    doc = deps.get_session_store().get_document(sid)
    event_kinds = [ev.kind for ev in doc.history]
    assert "widget.accepted" in event_kinds


def test_accept_widget_flips_status_to_accepted(client) -> None:
    """accept_widget MUST flip widget.status to 'accepted'."""
    sid = _create_session(client)
    wid = _push_widget(sid)

    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "active"

    body = client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True

    assert doc.widgets[wid].status == "accepted", (
        "accept_widget must flip widget.status to 'accepted'"
    )


def test_accept_widget_keeps_widget_in_doc(client) -> None:
    """accept_widget MUST NOT remove the widget from doc.widgets."""
    sid = _create_session(client)
    wid = _push_widget(sid)

    client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    )

    doc = deps.get_session_store().get_document(sid)
    assert wid in doc.widgets, "accept_widget must NOT remove widget from doc.widgets"
    assert wid in doc.widget_order, "accept_widget must NOT remove widget from doc.widget_order"


def test_accept_widget_keeps_nodes_in_operation_graph(client) -> None:
    """accept_widget MUST keep the canonical nodes in the projected operation_graph.
    Nodes come from canonical, not from the widget — seed canonical before testing."""
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    wid = _push_widget(sid)

    doc = deps.get_session_store().get_document(sid)
    # Seed canonical to match the widget's node (layer_id="layer_01", op="kelvin")
    doc.set_param("layer_01", "kelvin", "temperature", 5800)

    graph_before = project_to_graph(doc)
    canon_node_id = "canon:layer_01:kelvin"
    assert any(n.id == canon_node_id for n in graph_before.nodes), (
        "test prerequisite: canonical node must appear in op_graph before accept"
    )

    client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    )

    graph_after = project_to_graph(doc)
    assert any(n.id == canon_node_id for n in graph_after.nodes), (
        "accept_widget must not remove canonical nodes from operation_graph"
    )
