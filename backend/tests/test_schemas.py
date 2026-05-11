from app.schemas.operation_graph import OperationGraph
from app.schemas.image_context import ImageContext


def test_operation_graph_roundtrip(sample_operation_graph: dict) -> None:
    parsed = OperationGraph.model_validate(sample_operation_graph)
    assert parsed.id == "graph_01"
    assert parsed.nodes[0].type == "kelvin"
    assert parsed.nodes[0].scope.kind == "global"
    assert parsed.panel_bindings[0].label == "warm cast"
    dumped = parsed.model_dump(mode="json")
    assert dumped["nodes"][0]["params"]["temperature"] == 5800


def test_operation_graph_rejects_unknown_scope_kind(sample_operation_graph: dict) -> None:
    bad = {**sample_operation_graph}
    bad["nodes"][0]["scope"] = {"kind": "telepathic"}
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        OperationGraph.model_validate(bad)


def test_image_context_roundtrip(sample_image_context: dict) -> None:
    parsed = ImageContext.model_validate(sample_image_context)
    assert parsed.lighting == "backlit"
    assert parsed.candidate_regions[0].label == "subject"
    dumped = parsed.model_dump(mode="json")
    assert dumped["lighting"] == "backlit"
