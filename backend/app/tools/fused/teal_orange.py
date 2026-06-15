from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class TealOrangeTemplate(FusedToolTemplate):
    id = "teal_orange"
    label = "Teal & orange"
    description = "Teal-and-orange cinematic grade — curve approximation plus selective saturation boost."
    typical_use = "Use when the user wants a teal-orange colour grade or cinematic look."

    node_skeleton = [
        NodeSkeleton(
            node_type="curves", fixed_params={},
            tunable_param_keys=["points"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="points", label="Tonal curve",
            control_type="curve",
            control_schema=ControlSchema.model_validate(
                {"control_type": "curve", "channel": "luma", "min_points": 2, "max_points": 16}
            ),
            target=NodeParamTarget(node_id="n_curves", param_key="points"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="sat_boost", label="Saturation boost",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -50, "max": 50, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "sat_boost": ParamRange(min=-50, max=50, step=1, skin_safe_max=15),
    }
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "color_palette"]
