from app.schemas.operation_graph import Node


def test_node_defaults_to_composite_mode():
    n = Node(id="n1", type="exposure", layer_id="L1")
    assert n.layer_ids_mode == "composite"


def test_node_accepts_replicate_mode():
    n = Node(
        id="n1",
        type="exposure",
        layer_id="L1",
        layer_ids=["L1", "L2"],
        layer_ids_mode="replicate",
    )
    assert n.layer_ids_mode == "replicate"
    assert n.layer_ids == ["L1", "L2"]
