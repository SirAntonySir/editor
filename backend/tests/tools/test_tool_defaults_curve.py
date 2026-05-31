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
    (the renderer reads the points from the projected op_graph, not the widget).
    Nodes now come from canonical — seed it with the full curves value."""
    from app.state.document import SessionDocument
    from app.state.operations import project_to_graph

    nd = TOOL_DEFAULTS["curves"]["nodes"][0]
    curves_params = nd["params"]
    layer_id = nd.get("layer_id", "legacy")

    doc = SessionDocument(session_id="s1")
    # Seed canonical: each top-level key in curves_params is a separate param
    for param_key, param_val in curves_params.items():
        doc.set_param(layer_id, "curves", param_key, param_val)
    graph = project_to_graph(doc)

    # The canonical node id for this (layer, op) pair
    canon_id = f"canon:{layer_id}:curves"
    proj = next(n for n in graph.nodes if n.id == canon_id)
    assert proj.params["curves"]["rgb"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert proj.params["curves"]["red"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert proj.params["curves"]["green"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert proj.params["curves"]["blue"] == [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
