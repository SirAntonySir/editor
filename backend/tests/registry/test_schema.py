import pytest
from pydantic import ValidationError

from app.registry.schema import RegistryOp, RegistryPreset, OpParamSchema, OpCompoundConfig, CompoundAnchor


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


def test_compound_block_validates():
    op = RegistryOp.model_validate({
        "id": "tod", "display_name": "Time of Day",
        "category": "tone",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {
            "position": {"type": "scalar", "range": [0, 1], "default": 0.3, "step": 0.001},
            "k": {"type": "scalar", "range": [0, 100], "default": 50},
        },
        "bindings": [
            {"param_key": "position", "control_type": "slider", "label": "Time"},
            {"param_key": "k", "control_type": "slider", "label": "K"},
        ],
        "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
        "compound": {
            "driver": "position",
            "interpolation": "catmull_rom_1d",
            "anchors": [
                {"position": 0.0, "name": "a", "values": {"k": 10}},
                {"position": 1.0, "name": "b", "values": {"k": 90}},
            ],
        },
    })
    assert op.compound is not None
    assert op.compound.driver == "position"
    assert len(op.compound.anchors) == 2


def test_compound_rejects_unsorted_anchors():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "tod", "display_name": "T", "category": "tone",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "position": {"type": "scalar", "range": [0, 1], "default": 0.3},
                "k": {"type": "scalar", "range": [0, 100], "default": 50},
            },
            "bindings": [
                {"param_key": "position", "control_type": "slider", "label": "T"},
                {"param_key": "k", "control_type": "slider", "label": "K"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "position", "interpolation": "catmull_rom_1d",
                "anchors": [
                    {"position": 0.5, "name": "b", "values": {"k": 90}},
                    {"position": 0.0, "name": "a", "values": {"k": 10}},
                ],
            },
        })


def test_compound_rejects_driver_not_in_params():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "tod", "display_name": "T", "category": "tone",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "k": {"type": "scalar", "range": [0, 100], "default": 50},
            },
            "bindings": [
                {"param_key": "k", "control_type": "slider", "label": "K"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "nonexistent", "interpolation": "catmull_rom_1d",
                "anchors": [
                    {"position": 0.0, "name": "a", "values": {"k": 10}},
                    {"position": 1.0, "name": "b", "values": {"k": 90}},
                ],
            },
        })


def test_compound_rejects_anchor_value_key_not_in_params():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "tod", "display_name": "T", "category": "tone",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "position": {"type": "scalar", "range": [0, 1], "default": 0.3},
            },
            "bindings": [
                {"param_key": "position", "control_type": "slider", "label": "T"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "position", "interpolation": "catmull_rom_1d",
                "anchors": [
                    {"position": 0.0, "name": "a", "values": {"unknown_key": 10}},
                    {"position": 1.0, "name": "b", "values": {"unknown_key": 90}},
                ],
            },
        })


def test_compound_optional():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X", "category": "tone",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
    })
    assert op.compound is None


def test_compound_topology_defaults_to_linear():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X", "category": "mood",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {
            "p": {"type": "scalar", "range": [0, 1], "default": 0.5},
            "k": {"type": "scalar", "range": [0, 100], "default": 50},
        },
        "bindings": [
            {"param_key": "p", "control_type": "slider", "label": "P"},
            {"param_key": "k", "control_type": "slider", "label": "K"},
        ],
        "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
        "compound": {
            "driver": "p", "interpolation": "catmull_rom_1d",
            "anchors": [
                {"position": 0.0, "name": "a", "values": {"k": 10}},
                {"position": 1.0, "name": "b", "values": {"k": 90}},
            ],
        },
    })
    assert op.compound.topology == "linear"


def test_compound_topology_accepts_wheel():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X", "category": "mood",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {
            "p": {"type": "scalar", "range": [0, 1], "default": 0.5},
            "k": {"type": "scalar", "range": [0, 100], "default": 50},
        },
        "bindings": [
            {"param_key": "p", "control_type": "slider", "label": "P"},
            {"param_key": "k", "control_type": "slider", "label": "K"},
        ],
        "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
        "compound": {
            "driver": "p", "interpolation": "catmull_rom_1d", "topology": "wheel",
            "anchors": [
                {"position": 0.0, "name": "a", "values": {"k": 10}},
                {"position": 1.0, "name": "b", "values": {"k": 90}},
            ],
        },
    })
    assert op.compound.topology == "wheel"


def test_compound_topology_rejects_unknown():
    with pytest.raises(ValidationError):
        RegistryOp.model_validate({
            "id": "x", "display_name": "X", "category": "mood",
            "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
            "params": {
                "p": {"type": "scalar", "range": [0, 1], "default": 0.5},
                "k": {"type": "scalar", "range": [0, 100], "default": 50},
            },
            "bindings": [
                {"param_key": "p", "control_type": "slider", "label": "P"},
                {"param_key": "k", "control_type": "slider", "label": "K"},
            ],
            "engine": {"shader": "compound", "render_order": 5, "node_type": "compound"},
            "compound": {
                "driver": "p", "interpolation": "catmull_rom_1d", "topology": "radial-grid",
                "anchors": [
                    {"position": 0.0, "name": "a", "values": {"k": 10}},
                    {"position": 1.0, "name": "b", "values": {"k": 90}},
                ],
            },
        })


def test_compound_anchor_color_optional():
    """Color is optional. Both null and a CSS string are accepted."""
    a1 = CompoundAnchor.model_validate(
        {"position": 0.0, "name": "x", "values": {"k": 1}}
    )
    assert a1.color is None
    a2 = CompoundAnchor.model_validate(
        {"position": 0.0, "name": "x", "values": {"k": 1}, "color": "#22c55e"}
    )
    assert a2.color == "#22c55e"


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
