from app.tools.tool_defaults import TOOL_DEFAULTS

IDENTITY = [{"x": 0, "y": 0}, {"x": 1, "y": 1}]


def test_curves_tool_uses_curve_control_with_identity_points():
    curves = TOOL_DEFAULTS["curves"]
    node_params = curves["nodes"][0]["params"]
    assert node_params["curves"] == {
        "rgb": IDENTITY, "red": IDENTITY, "green": IDENTITY, "blue": IDENTITY,
    }
    assert curves["nodes"][0]["type"] == "curves"
    b = curves["bindings"][0]
    assert b["param_key"] == "curves"
    assert b["control_type"] == "curve"
    assert b["control_schema"]["control_type"] == "curve"


def test_curves_node_survives_op_graph_projection():
    """A curves widget's structured `curves` param must survive project_to_graph
    (the renderer reads the points from the projected op_graph, not the widget)."""
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

    nd = TOOL_DEFAULTS["curves"]["nodes"][0]
    curves_params = nd["params"]

    wid = "w_curves_1"
    node_id = "n_curves_1"

    widget = Widget(
        id=wid,
        intent="curves adjustment",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="tool_invoked"),
        fused_tool_id="curves",
        nodes=[
            WidgetNode(
                id=node_id,
                type="curves",
                params=curves_params,
                scope=Scope.model_validate({"kind": "global"}),
                inputs=[],
                widget_id=wid,
            )
        ],
        bindings=[
            ControlBinding(
                param_key="curves",
                label="Curves",
                control_type="curve",
                target=NodeParamTarget(node_id=node_id, param_key="curves"),
                control_schema=ControlSchema.model_validate(
                    {"control_type": "curve", "channel": "luma", "min_points": 2, "max_points": 16}
                ),
                value=curves_params["curves"],
                default=curves_params["curves"],
            )
        ],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        status="active",
        revision=1,
    )

    doc = SessionDocument(session_id="s1")
    doc.add_widget(widget)
    graph = project_to_graph(doc)

    proj = next(n for n in graph.nodes if n.id == node_id)
    assert proj.params["curves"]["rgb"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert proj.params["curves"]["red"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert proj.params["curves"]["green"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert proj.params["curves"]["blue"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
