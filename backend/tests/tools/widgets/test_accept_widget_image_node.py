"""T18 — accepting an image_node-scope widget produces an operation_graph
projection where each Node carries layer_ids matching the widget scope."""
from __future__ import annotations

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


def _push_image_node_widget(sid: str, layer_ids: list[str]) -> str:
    from app.schemas.widget import (
        ImageNodeScope,
        Scope,
        Widget,
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    doc = deps.get_session_store().get_document(sid)
    scope = Scope(root=ImageNodeScope(
        kind="image_node",
        image_node_id="in-1",
        layer_ids=layer_ids,
    ))
    primary_layer = layer_ids[0] if layer_ids else "legacy"
    wn = WidgetNode(
        id="node_imagenode_test",
        type="kelvin",
        scope=scope,
        params={"temperature": 5800},
        widget_id="w_imagenode_test",
        layer_id=primary_layer,
        layer_ids=list(layer_ids),
    )
    w = Widget(
        id="w_imagenode_test",
        intent="warm subjects only",
        scope=scope,
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


def test_accept_widget_projects_layer_ids_into_operation_graph(client) -> None:
    """After accepting an image_node-scope widget, project_to_graph must
    produce Nodes whose layer_ids match the widget scope."""
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    layer_ids = ["l-1", "l-2", "l-3"]
    wid = _push_image_node_widget(sid, layer_ids)

    body = client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True

    doc = deps.get_session_store().get_document(sid)
    graph = project_to_graph(doc)
    widget_nodes = [n for n in graph.nodes if n.widget_id == wid]
    assert widget_nodes, "widget nodes must be present in projected graph"
    for n in widget_nodes:
        assert n.layer_ids == layer_ids, (
            f"Node.layer_ids should mirror widget scope. "
            f"Expected {layer_ids}, got {n.layer_ids}"
        )
        # Primary layer_id remains populated for legacy consumers.
        assert n.layer_id == "l-1"
        # GraphScope falls back to "global" for image_node scopes (membership
        # is carried via layer_ids, not scope.kind).
        assert n.scope.kind == "global"


def test_project_to_graph_leaves_layer_ids_none_for_global_scope(client) -> None:
    """Global-scope widgets must not get layer_ids populated by the projector."""
    from app.schemas.widget import (
        GlobalScope,
        Scope,
        Widget,
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    doc = deps.get_session_store().get_document(sid)
    wn = WidgetNode(
        id="n_global",
        type="kelvin",
        scope=Scope(root=GlobalScope(kind="global")),
        params={"temperature": 5500},
        widget_id="w_global",
        layer_id="layer_a",
    )
    w = Widget(
        id="w_global",
        intent="cool everywhere",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"),
        nodes=[wn],
    )
    doc.add_widget(w)

    graph = project_to_graph(doc)
    matching = [n for n in graph.nodes if n.widget_id == "w_global"]
    assert matching
    for n in matching:
        assert n.layer_ids is None
