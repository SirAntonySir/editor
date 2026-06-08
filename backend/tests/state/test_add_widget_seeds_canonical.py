"""add_widget seeds the canonical slot from a widget's nodes — covering ALL
creation paths (tool_invoked, fused/LLM, autonomous) in one place, so a widget
projects right after creation."""
from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget, Scope, Widget, WidgetNode,
    WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument
from app.state.operations import project_to_graph


def _widget(wid: str, layer_id: str, op: str, params: dict, origin_kind: str = "mcp_autonomous") -> Widget:
    return Widget(
        id=wid, intent="x", scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind=origin_kind, prompt=None),
        op_id="warm_grade",
        nodes=[WidgetNode(
            id=f"n_{wid}", type=op, params=params,
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id=wid, layer_id=layer_id,
        )],
        bindings=[],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        status="active", revision=1,
    )


def test_add_widget_seeds_canonical_from_nodes():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "layer_a", "basic", {"exposure": 12, "contrast": 5}))
    assert doc.canonical["layer_a"]["basic"] == {"exposure": 12, "contrast": 5}


def test_added_autonomous_widget_projects_immediately():
    """A non-tool_invoked (autonomous/fused) widget projects to op_graph right
    after add_widget — proving its params reach canonical."""
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "layer_a", "kelvin", {"kelvin": 6200}, origin_kind="mcp_autonomous"))
    graph = project_to_graph(doc)
    assert any(n.layer_id == "layer_a" and n.type == "kelvin"
               and n.params.get("kelvin") == 6200 for n in graph.nodes)
