import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.delete_widget import DeleteWidgetTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "delete_widget" not in reg._tools:
        reg.register(DeleteWidgetTool())
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


def _push_widget(sid: str) -> str:
    """Directly inject a widget with a WidgetNode so op-graph assertions are reliable."""
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
        id="node_delete_test",
        type="kelvin",
        scope=Scope(root=GlobalScope(kind="global")),
        params={"temperature": 5800},
        widget_id="w_delete_test",
        layer_id="layer_01",
    )
    w = Widget(
        id="w_delete_test",
        intent="make it warmer",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"),
        nodes=[wn],
    )
    doc.add_widget(w)
    return w.id


def _create_session(client: TestClient) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


# ── pre-existing tests (unchanged contract) ──────────────────────────────────

def test_delete_with_suppress_dismisses_and_adds_rule(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": True}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "dismissed"
    assert len(doc.dismissals) == 1
    assert doc.dismissals[0].source_widget_id == wid


def test_delete_without_suppress_dismisses_no_rule(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "dismissed"
    assert doc.dismissals == []


# ── T19 tests: SSoT contract ─────────────────────────────────────────────────

def test_delete_widget_flips_status_to_dismissed(client) -> None:
    """delete_widget MUST flip widget.status to 'dismissed' and keep it in doc.widgets."""
    sid = _create_session(client)
    wid = _push_widget(sid)

    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "active"

    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    ).json()
    assert body["ok"] is True

    assert wid in doc.widgets, "delete_widget must NOT remove widget from doc.widgets"
    assert wid in doc.widget_order, "delete_widget must NOT remove widget from doc.widget_order"
    assert doc.widgets[wid].status == "dismissed", (
        "delete_widget must flip widget.status to 'dismissed'"
    )


def test_delete_widget_resets_owned_canonical_params(client) -> None:
    """delete_widget IS the 'close (×)' action (Q2: 'close → value resets').
    It resets the canonical params the widget owns and prunes the now-empty
    slot, so the owned node disappears from the op_graph projection. (accept,
    by contrast, keeps canonical — see test_accept_widget.)"""
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    wid = _push_widget(sid)  # node: layer_01 / kelvin / temperature=5800

    doc = deps.get_session_store().get_document(sid)
    canon_node_id = "canon:layer_01:kelvin"
    graph_before = project_to_graph(doc)
    assert any(n.id == canon_node_id for n in graph_before.nodes), (
        "test prerequisite: canonical node must be in op_graph before delete"
    )

    client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    )

    # Widget is dismissed AND its owned canonical params are reset → node gone.
    graph_after = project_to_graph(doc)
    assert not any(n.id == canon_node_id for n in graph_after.nodes), (
        "delete_widget (close) must reset the widget's owned canonical params"
    )


def test_delete_widget_after_accept_keeps_canonical(client) -> None:
    """The intent doc'd on dismiss_widget says '(accept_widget keeps canonical)'
    — meaning the user's Apply flow commits the values, and a subsequent
    close on the now-accepted widget should NOT roll them back.

    Without this guard, the WidgetShell Apply → SSE removes the widget →
    user clicks × on the next widget → previous canonical wiped → the
    adjustment sliders the user just committed to in the inspector drop
    back to defaults the next time the user opens the canvas widget."""
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    wid = _push_widget(sid)  # node: layer_01 / kelvin / temperature=5800

    # Apply first.
    client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    )

    doc = deps.get_session_store().get_document(sid)
    canon_node_id = "canon:layer_01:kelvin"
    pre_close_graph = project_to_graph(doc)
    pre_close_node = next(
        (n for n in pre_close_graph.nodes if n.id == canon_node_id),
        None,
    )
    assert pre_close_node is not None and pre_close_node.params.get("temperature") == 5800, (
        "test prerequisite: accept_widget must have committed the value to canonical"
    )

    # Now close (×) the accepted widget.
    client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    )

    post_close_graph = project_to_graph(doc)
    post_close_node = next(
        (n for n in post_close_graph.nodes if n.id == canon_node_id),
        None,
    )
    assert post_close_node is not None, (
        "close after accept must NOT remove the canonical node — the user committed those values"
    )
    assert post_close_node.params.get("temperature") == 5800, (
        f"close after accept must NOT roll back the canonical param "
        f"(got {post_close_node.params.get('temperature')!r}, expected 5800)"
    )


def test_delete_widget_emits_widget_deleted_event(client) -> None:
    """delete_widget MUST emit a 'widget.deleted' history event."""
    sid = _create_session(client)
    wid = _push_widget(sid)

    doc = deps.get_session_store().get_document(sid)

    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    ).json()
    assert body["ok"] is True

    event_kinds = [ev.kind for ev in doc.history]
    assert "widget.deleted" in event_kinds, (
        f"delete_widget must emit 'widget.deleted' event. Got: {event_kinds}"
    )
