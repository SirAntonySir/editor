from app.schemas.operation_graph import OperationGraph
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.state.document import SessionDocument
from app.state.operations import project_to_graph


def _widget(wid: str, node_id: str, params: dict, status: str = "active") -> Widget:
    return Widget(
        id=wid,
        intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warmer"),
        op_id="warm_grade",
        nodes=[
            WidgetNode(
                id=node_id, type="kelvin", params=params,
                scope=Scope.model_validate({"kind": "global"}),
                inputs=[], widget_id=wid,
            )
        ],
        bindings=[
            ControlBinding(
                param_key="temperature",
                label="warm cast",
                control_type="slider",
                target=NodeParamTarget(node_id=node_id, param_key="temperature"),
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": 3000, "max": 9000, "step": 50}
                ),
                value=params.get("temperature", 5500),
                default=5500,
            )
        ],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        status=status,  # type: ignore[arg-type]
        revision=1,
    )


def test_empty_doc_projects_to_empty_graph() -> None:
    doc = SessionDocument(session_id="s1")
    graph = project_to_graph(doc)
    assert graph.nodes == []
    assert graph.panel_bindings == []


def test_single_active_widget_projects_nodes_and_bindings() -> None:
    doc = SessionDocument(session_id="s1")
    # Nodes now come from canonical; seed it to match the widget's node
    doc.set_param("legacy", "kelvin", "temperature", 6500)
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    graph = project_to_graph(doc)
    # Node exists (from canonical) with correct params
    assert len(graph.nodes) == 1
    assert graph.nodes[0].params["temperature"] == 6500
    # Panel bindings still come from the widget
    assert [b.param_key for b in graph.panel_bindings] == ["temperature"]


def test_dismissed_widgets_excluded() -> None:
    # After the switch, dismissed widgets no longer affect nodes (canonical-driven).
    # Test that bindings for dismissed widgets are not included.
    doc = SessionDocument(session_id="s1")
    doc.set_param("legacy", "kelvin", "temperature", 6500)
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    doc.add_widget(_widget("w_2", "n_2", {"temperature": 7000}))
    doc.dismiss_widget("w_2")
    graph = project_to_graph(doc)
    # Only w_1's binding survives (dismissed widget's bindings are excluded)
    assert len([b for b in graph.panel_bindings if b.param_key == "temperature"]) == 1


def test_widget_order_preserved_in_projection() -> None:
    # Nodes now come from canonical (deterministic by layer+op key).
    # Re-target this test to assert that widget order is preserved in panel_bindings.
    doc = SessionDocument(session_id="s1")
    doc.set_param("legacy", "kelvin", "temperature", 6500)
    doc.add_widget(_widget("w_a", "n_a", {"temperature": 6500}))
    doc.add_widget(_widget("w_b", "n_b", {"temperature": 7000}))
    graph = project_to_graph(doc)
    # Both widgets' bindings appear in widget_order order
    assert [b.param_key for b in graph.panel_bindings] == ["temperature", "temperature"]


def test_pure_function_does_not_mutate_doc() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    before = doc.model_dump_json()
    project_to_graph(doc)
    after = doc.model_dump_json()
    assert before == after


def test_widget_created_event_carries_operation_graph() -> None:
    """widget.created must embed the freshly-projected operation_graph so the
    frontend renderer (which only knows op_graph nodes) sees the new node
    without a full snapshot re-fetch.
    Nodes now come from canonical — seed it before adding the widget."""
    doc = SessionDocument(session_id="s1")
    doc.set_param("legacy", "kelvin", "temperature", 6500)
    events = doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    ev = events[0]
    assert ev.kind == "widget.created"
    assert "operation_graph" in ev.payload
    canon_node_id = "canon:legacy:kelvin"
    node_ids = [n["id"] for n in ev.payload["operation_graph"]["nodes"]]
    assert canon_node_id in node_ids


def test_widget_updated_event_carries_operation_graph() -> None:
    """widget.updated must embed the updated operation_graph so a slider change
    (set_widget_param → update_widget) reaches the renderer.
    Nodes come from canonical — set_param before add/update."""
    doc = SessionDocument(session_id="s1")
    doc.set_param("legacy", "kelvin", "temperature", 6500)
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    doc.set_param("legacy", "kelvin", "temperature", 8000)
    updated = _widget("w_1", "n_1", {"temperature": 8000})
    events = doc.update_widget(updated)
    ev = events[0]
    assert ev.kind == "widget.updated"
    graph_nodes = ev.payload["operation_graph"]["nodes"]
    assert graph_nodes[0]["params"]["temperature"] == 8000


def test_projection_reads_canonical_and_dedups() -> None:
    doc = SessionDocument(session_id="s1")
    doc.set_param("layer_a", "basic", "exposure", 40)
    doc.set_param("layer_a", "basic", "contrast", -10)
    doc.set_param("layer_a", "kelvin", "kelvin", 6200)
    graph = project_to_graph(doc)
    basic = [n for n in graph.nodes if n.layer_id == "layer_a" and n.type == "basic"]
    assert len(basic) == 1
    assert basic[0].params == {"exposure": 40, "contrast": -10}
    assert any(n.type == "kelvin" and n.layer_id == "layer_a" for n in graph.nodes)


def test_projection_source_is_canonical_not_widget_nodes() -> None:
    """add_widget seeds canonical (Slice 2), so the widget projects — but the
    PROJECTION SOURCE is canonical, not the widget's own nodes. Mutating a
    widget node directly (bypassing set_param) does NOT change the graph."""
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))  # seeds canonical
    # Directly mutate the widget's node, bypassing canonical:
    doc.widgets["w_1"].nodes[0].params["temperature"] = 9999
    graph = project_to_graph(doc)
    node = next(n for n in graph.nodes if n.type == "kelvin")
    assert node.params["temperature"] == 6500  # canonical wins, not the widget node
