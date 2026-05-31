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
        fused_tool_id="warm_grade",
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
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    graph = project_to_graph(doc)
    assert [n.id for n in graph.nodes] == ["n_1"]
    assert graph.nodes[0].params["temperature"] == 6500
    assert [b.param_key for b in graph.panel_bindings] == ["temperature"]


def test_dismissed_widgets_excluded() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    doc.add_widget(_widget("w_2", "n_2", {"temperature": 7000}))
    doc.dismiss_widget("w_2")
    graph = project_to_graph(doc)
    assert [n.id for n in graph.nodes] == ["n_1"]


def test_widget_order_preserved_in_projection() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_a", "n_a", {"temperature": 6500}))
    doc.add_widget(_widget("w_b", "n_b", {"temperature": 7000}))
    graph = project_to_graph(doc)
    assert [n.id for n in graph.nodes] == ["n_a", "n_b"]


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
    without a full snapshot re-fetch."""
    doc = SessionDocument(session_id="s1")
    events = doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    ev = events[0]
    assert ev.kind == "widget.created"
    assert "operation_graph" in ev.payload
    node_ids = [n["id"] for n in ev.payload["operation_graph"]["nodes"]]
    assert "n_1" in node_ids


def test_widget_updated_event_carries_operation_graph() -> None:
    """widget.updated must embed the updated operation_graph so a slider change
    (set_widget_param → update_widget) reaches the renderer."""
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    updated = _widget("w_1", "n_1", {"temperature": 8000})
    events = doc.update_widget(updated)
    ev = events[0]
    assert ev.kind == "widget.updated"
    graph_nodes = ev.payload["operation_graph"]["nodes"]
    assert graph_nodes[0]["params"]["temperature"] == 8000
