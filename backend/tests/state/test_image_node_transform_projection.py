from app.state.document import SessionDocument
from app.state.operations import project_to_graph


def test_crop_emits_image_node_scope_node() -> None:
    doc = SessionDocument(session_id="s-1")
    doc.image_node_transforms["in-1"] = {
        "layer_ids": ["l-1", "l-2"],
        "crop": {"x": 10, "y": 20, "w": 100, "h": 80},
        "rotate": None,
    }
    g = project_to_graph(doc)
    crop_nodes = [n for n in g.nodes if n.type == "crop"]
    assert len(crop_nodes) == 1
    n = crop_nodes[0]
    assert n.params == {"x": 10, "y": 20, "w": 100, "h": 80}
    assert n.layer_ids == ["l-1", "l-2"]
    assert n.layer_id == "l-1"  # legacy required field — first layer.
    assert n.id == "transform:in-1:crop"
    assert n.scope.kind == "global"
    assert n.widget_id is None


def test_rotate_emits_image_node_scope_node() -> None:
    doc = SessionDocument(session_id="s-1")
    doc.image_node_transforms["in-1"] = {
        "layer_ids": ["l-1"],
        "crop": None,
        "rotate": {"angle": 90.0, "flip_h": False, "flip_v": False},
    }
    g = project_to_graph(doc)
    rotate_nodes = [n for n in g.nodes if n.type == "rotate"]
    assert len(rotate_nodes) == 1
    assert rotate_nodes[0].params == {"angle": 90.0, "flip_h": False, "flip_v": False}
    assert rotate_nodes[0].id == "transform:in-1:rotate"
    assert rotate_nodes[0].scope.kind == "global"
    assert rotate_nodes[0].widget_id is None


def test_both_crop_and_rotate_emit_two_nodes() -> None:
    doc = SessionDocument(session_id="s-1")
    doc.image_node_transforms["in-1"] = {
        "layer_ids": ["l-1"],
        "crop": {"x": 0, "y": 0, "w": 100, "h": 100},
        "rotate": {"angle": 90.0, "flip_h": False, "flip_v": False},
    }
    g = project_to_graph(doc)
    types = sorted(n.type for n in g.nodes)
    assert "crop" in types and "rotate" in types
