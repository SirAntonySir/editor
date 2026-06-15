from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class SkyRecoveryTemplate(FusedToolTemplate):
    id = "sky_recovery"
    label = "Recover sky"
    description = "Recovers blown-out sky detail — pulls highlights/whites with a curve refinement."
    typical_use = "Use when the user wants to recover sky detail, reduce overexposed sky, or balance sky and foreground."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["highlights", "whites", "saturation"],
        ),
        NodeSkeleton(
            node_type="curves", fixed_params={},
            tunable_param_keys=["points"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="highlights", label="Highlights",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="highlights"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="whites", label="Whites",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="whites"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="saturation", label="Sky saturation",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="points", label="Highlight curve",
            control_type="curve",
            control_schema=ControlSchema.model_validate(
                {"control_type": "curve", "channel": "luma", "min_points": 2, "max_points": 16}
            ),
            target=NodeParamTarget(node_id="n_curves", param_key="points"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "highlights": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
        "whites": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
        "saturation": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
    }
    safety = {"skin_protect": True}
    context_inputs = ["clipped_highlights_pct", "region_stats.dominant_swatches", "region_stats.is_sky_likely"]
