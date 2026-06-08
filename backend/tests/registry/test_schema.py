import pytest
from pydantic import ValidationError

from app.registry.schema import RegistryOp, RegistryPreset, OpParamSchema


def test_minimal_op_validates():
    op = RegistryOp.model_validate({
        "id": "grain",
        "display_name": "Grain",
        "llm": {
            "description": "Film grain texture.",
            "typical_use": "Adds analog feel.",
            "semantic_tags": ["texture", "film"],
        },
        "params": {
            "amount": {"type": "scalar", "range": [0, 100], "default": 0},
        },
        "bindings": [
            {"param_key": "amount", "control_type": "slider", "label": "Amount"},
        ],
        "engine": {"shader": "grain", "render_order": 50, "node_type": "grain"},
    })
    assert op.id == "grain"
    assert op.params["amount"].default == 0


def test_op_rejects_unknown_control_type():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "x", "display_name": "X",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
            "bindings": [{"param_key": "a", "control_type": "made_up", "label": "A"}],
            "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
        })


def test_op_rejects_binding_for_unknown_param():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "x", "display_name": "X",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
            "bindings": [{"param_key": "b", "control_type": "slider", "label": "B"}],
            "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
        })


def test_curve_points_param_schema():
    schema = OpParamSchema.model_validate({
        "type": "curve_points",
        "default": [[0, 0], [255, 255]],
        "min_points": 2,
        "max_points": 16,
    })
    assert schema.type == "curve_points"


def test_op_param_scalar_requires_range():
    with pytest.raises(ValidationError):
        OpParamSchema.model_validate({"type": "scalar", "default": 0})


def test_op_param_enum_requires_values():
    with pytest.raises(ValidationError):
        OpParamSchema.model_validate({"type": "enum", "default": "a"})


def test_op_param_curve_points_rejects_empty_default():
    with pytest.raises(ValidationError):
        OpParamSchema.model_validate({
            "type": "curve_points", "default": [], "min_points": 2, "max_points": 16,
        })


def test_op_param_curve_points_rejects_malformed_default():
    with pytest.raises(ValidationError):
        OpParamSchema.model_validate({
            "type": "curve_points", "default": [[1], [2, 3]], "min_points": 2, "max_points": 16,
        })


def test_registry_op_accepts_category():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X",
        "category": "color",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
    })
    assert op.category == "color"


def test_registry_op_category_optional():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
    })
    assert op.category is None


def test_preset_validates():
    preset = RegistryPreset.model_validate({
        "id": "vintage",
        "display_name": "Vintage",
        "source": "builtin",
        "description": "Aged film look.",
        "typical_use": "Nostalgic edits.",
        "semantic_tags": ["mood", "vintage"],
        "ops": [
            {"op_id": "grain", "params": {"amount": 15}},
        ],
    })
    assert preset.ops[0].op_id == "grain"
