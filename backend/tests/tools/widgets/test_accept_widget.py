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


def _push_widget_with_binding(sid: str) -> tuple[str, str, float]:
    """Like `_push_widget` but the widget carries a ControlBinding so we can
    assert that accept_widget pushes the binding's value into canonical state."""
    from app.schemas.widget import (
        ControlBinding,
        ControlSchema,
        GlobalScope,
        NodeParamTarget,
        Scope,
        SliderSchema,
        Widget,
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    node_id = "node_w_binding"
    widget_id = "w_with_binding"
    layer_id = "layer_01"
    bound_value = 5800.0
    wn = WidgetNode(
        id=node_id,
        type="kelvin",
        scope=Scope(root=GlobalScope(kind="global")),
        params={"temperature": bound_value},
        widget_id=widget_id,
        layer_id=layer_id,
    )
    w = Widget(
        id=widget_id,
        intent="warm it up",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"),
        nodes=[wn],
        bindings=[
            ControlBinding(
                param_key="temperature",
                label="Temperature",
                control_type="slider",
                target=NodeParamTarget(node_id=node_id, param_key="temperature"),
                control_schema=ControlSchema(
                    root=SliderSchema(control_type="slider", min=2000, max=10000, step=50)
                ),
                value=bound_value,
                default=5500.0,
            )
        ],
    )
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(w)
    return widget_id, layer_id, bound_value


def test_accept_widget_writes_bindings_to_canonical(client) -> None:
    """The user expectation: accepting an AI widget should make its values
    show up on the per-tool adjustment sliders. The sliders read from
    canonical via the projected op_graph.

    add_widget already seeds canonical from `node.params` at create time,
    so a widget where bindings == node.params already projects correctly.
    But the autonomous mint path runs each binding through the LLM
    resolver after the node skeleton is built, and there is no guarantee
    the resolver writes the chosen value back to the matching node.params
    entry. When `binding.value` and `node.params[param_key]` disagree,
    canonical carries node.params (= template default) and the
    adjustment slider sits at the default instead of the AI value.

    accept_widget MUST close that gap: every binding's value lands on
    canonical, overwriting any stale node.params seed."""
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    wid, layer_id, _ = _push_widget_with_binding(sid)

    # Force the divergence the resolver-path can produce in production:
    # rewrite the binding value to one that node.params does NOT carry, so
    # the only way it reaches canonical is via accept_widget reading bindings.
    doc = deps.get_session_store().get_document(sid)
    binding_value_after_drift = 4200.0
    doc.widgets[wid].bindings[0].value = binding_value_after_drift

    body = client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True

    post_graph = project_to_graph(doc)
    post_node = next(
        (n for n in post_graph.nodes if n.id == f"canon:{layer_id}:kelvin"),
        None,
    )
    assert post_node is not None, (
        "accept_widget must seed a canonical node for the bound (layer, op)"
    )
    assert post_node.params.get("temperature") == binding_value_after_drift, (
        f"accept_widget must write the binding value (not the stale node.params) "
        f"to canonical (got {post_node.params.get('temperature')!r}, "
        f"expected {binding_value_after_drift!r})"
    )


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
