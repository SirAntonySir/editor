from app.schemas.widget import Scope


def test_replicate_scope_parses_targets():
    s = Scope.model_validate(
        {
            "kind": "replicate",
            "targets": [
                {"imageNodeId": "img_a", "layerId": "L1"},
                {"imageNodeId": "img_b", "layerId": "L2"},
            ],
        }
    )
    assert s.root.kind == "replicate"
    assert [t.layer_id for t in s.root.targets] == ["L1", "L2"]
    assert s.root.targets[0].image_node_id == "img_a"


def test_replicate_scope_defaults_to_empty_targets():
    s = Scope.model_validate({"kind": "replicate"})
    assert s.root.kind == "replicate"
    assert s.root.targets == []
