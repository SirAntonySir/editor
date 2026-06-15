from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class WarmGradeTemplate(FusedToolTemplate):
    id = "warm_grade"
    label = "Warm grade"
    description = "Subjective 'warmer' — coordinated kelvin shift, highlight warmth, slight saturation."
    typical_use = "Use when the user asks to warm up the image, the subject, or a region."

    node_skeleton = [
        NodeSkeleton(node_type="kelvin", fixed_params={}, tunable_param_keys=["temperature"]),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["highlights", "saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="temperature", label="Warmth",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50, "unit": "K"}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="highlight_warmth", label="Highlight warmth",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -30, "max": 30, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="highlights"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="saturation_lift", label="Saturation lift",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -20, "max": 20, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "temperature": ParamRange(min=-1200, max=1200, step=50, skin_safe_max=400),
        "highlight_warmth": ParamRange(min=-30, max=30, step=1, skin_safe_max=8),
        "saturation_lift": ParamRange(min=-20, max=20, step=1, skin_safe_max=5),
    }
    safety = {"skin_protect": True}
    context_inputs = ["cast_direction", "wb_neutral_confidence", "grade_character"]
