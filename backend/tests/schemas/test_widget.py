import pytest
from pydantic import ValidationError

from app.schemas.widget import (
    GlobalScope,
    MaskScope,
    NamedRegionScope,
    NodeParamTarget,
    Scope,
)


def test_scope_global() -> None:
    s = Scope.model_validate({"kind": "global"})
    assert isinstance(s.root, GlobalScope)


def test_scope_named_region() -> None:
    s = Scope.model_validate({"kind": "named_region", "label": "subject"})
    assert isinstance(s.root, NamedRegionScope)
    assert s.root.label == "subject"


def test_scope_mask() -> None:
    s = Scope.model_validate({"kind": "mask", "mask_id": "m_1"})
    assert isinstance(s.root, MaskScope)
    assert s.root.mask_id == "m_1"


def test_scope_unknown_kind_rejected() -> None:
    with pytest.raises(ValidationError):
        Scope.model_validate({"kind": "nonsense"})


def test_node_param_target_roundtrip() -> None:
    t = NodeParamTarget(node_id="n1", param_key="temperature")
    assert NodeParamTarget.model_validate(t.model_dump()) == t


from app.schemas.widget import (
    ChoiceSchema,
    ColorSchema,
    ControlBinding,
    ControlSchema,
    CurvePointSchema,
    CurveSchema,
    HistogramMarkerSchema,
    MaskThumbnailSchema,
    NumericPairSchema,
    RegionPickerSchema,
    SliderSchema,
    TextSchema,
    ToggleSchema,
    BeforeAfterToggleSchema,
)


def test_slider_schema_required_fields() -> None:
    s = SliderSchema(control_type="slider", min=0, max=100, step=1, unit="")
    assert s.control_type == "slider"


def test_control_schema_dispatches_by_type() -> None:
    raw = {"control_type": "toggle", "on_label": "On", "off_label": "Off"}
    cs = ControlSchema.model_validate(raw)
    assert isinstance(cs.root, ToggleSchema)


def test_control_schema_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        ControlSchema.model_validate({"control_type": "frob"})


def test_control_binding_construction_with_slider_schema() -> None:
    binding = ControlBinding(
        param_key="intensity",
        label="Intensity",
        control_type="slider",
        target=NodeParamTarget(node_id="n1", param_key="amount"),
        control_schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": 0, "max": 100, "step": 1, "unit": ""}
        ),
        value=42,
        default=0,
    )
    assert binding.value == 42


def test_control_binding_color_value_is_rgb_tuple() -> None:
    binding = ControlBinding(
        param_key="tint",
        label="Tint",
        control_type="color",
        target=NodeParamTarget(node_id="n2", param_key="rgb"),
        control_schema=ControlSchema.model_validate(
            {"control_type": "color", "space": "rgb", "show_alpha": False, "presets": []}
        ),
        value=[255, 200, 100],
        default=[128, 128, 128],
    )
    assert binding.value == [255, 200, 100]


def test_control_type_set() -> None:
    from app.schemas.widget import ControlType
    expected = {
        "slider", "numeric_pair", "toggle", "choice", "color", "curve",
        "curve_point", "mask_thumbnail", "region_picker",
        "before_after_toggle", "histogram_marker", "text",
    }
    assert set(ControlType.__args__) == expected


def test_control_type_matches_union_members() -> None:
    """ControlType literal set must equal the set of control_type literals
    across the schemas in the discriminated union. Catches drift when adding
    a new control type but forgetting to register it (or vice versa)."""
    from app.schemas.widget import (
        ControlType,
        SliderSchema, NumericPairSchema, ToggleSchema, ChoiceSchema, ColorSchema,
        CurveSchema, CurvePointSchema, MaskThumbnailSchema, RegionPickerSchema,
        BeforeAfterToggleSchema, HistogramMarkerSchema, TextSchema,
    )
    schemas = [
        SliderSchema, NumericPairSchema, ToggleSchema, ChoiceSchema, ColorSchema,
        CurveSchema, CurvePointSchema, MaskThumbnailSchema, RegionPickerSchema,
        BeforeAfterToggleSchema, HistogramMarkerSchema, TextSchema,
    ]
    # Each control_type field is Literal["..."] with a single value — pull it out.
    union_literals = {s.model_fields["control_type"].annotation.__args__[0] for s in schemas}
    assert set(ControlType.__args__) == union_literals
