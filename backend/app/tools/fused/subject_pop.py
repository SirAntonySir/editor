from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class SubjectPopTemplate(FusedToolTemplate):
    id = "subject_pop"
    label = "Subject pop"
    description = "Makes a subject or region pop — local contrast and saturation boost."
    typical_use = "Use when the user wants to make a subject, person, or region stand out."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast", "saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="contrast", label="Contrast pop",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -50, "max": 50, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="contrast"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="saturation", label="Saturation pop",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -30, "max": 30, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "non_global"
    param_envelope = {
        "contrast": ParamRange(min=-50, max=50, step=1, skin_safe_max=15),
        "saturation": ParamRange(min=-30, max=30, step=1, skin_safe_max=10),
    }
    safety = {"skin_protect": True}
    context_inputs = ["region_stats.contrast_p10_p90", "region_stats.is_skin_likely"]
