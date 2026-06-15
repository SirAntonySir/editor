from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class PortraitGlowTemplate(FusedToolTemplate):
    id = "portrait_glow"
    label = "Portrait glow"
    description = "Soft portrait glow — reduces clarity and adds a gentle warmth nudge for flattering skin."
    typical_use = "Use when the user wants a soft, glowing, or flattering portrait look."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast"],
        ),
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="clarity", label="Clarity (glow)",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -50, "max": 0, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="contrast"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="kelvin_nudge", label="Warmth nudge",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -400, "max": 400, "step": 50, "unit": "K"}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "skin_safe"
    param_envelope = {
        "clarity": ParamRange(min=-50, max=0, step=1, skin_safe_max=None),
        "kelvin_nudge": ParamRange(min=-400, max=400, step=50, skin_safe_max=200),
    }
    safety = {"skin_protect": True}
    context_inputs = [
        "region_stats.is_skin_likely", "region_stats.mean_luma",
        "region_stats.dominant_swatches",
    ]
