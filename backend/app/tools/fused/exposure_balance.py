from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class ExposureBalanceTemplate(FusedToolTemplate):
    id = "exposure_balance"
    label = "Balance exposure"
    description = "Balances tonal range — lift shadows, recover highlights, set white/black points."
    typical_use = "Use when the user wants to balance exposure, recover clipped areas, or improve tonal range."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["shadows", "highlights", "whites", "blacks"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="shadows", label="Shadows",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="shadows"),
            tunable_default=True,
        ),
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
            param_key="blacks", label="Blacks",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="blacks"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "shadows": ParamRange(min=-100, max=100, step=1, skin_safe_max=50),
        "highlights": ParamRange(min=-100, max=100, step=1, skin_safe_max=50),
        "whites": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
        "blacks": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
    }
    safety = {"skin_protect": True}
    context_inputs = [
        "luma_histogram", "clipped_shadows_pct", "clipped_highlights_pct", "median_luma",
    ]
