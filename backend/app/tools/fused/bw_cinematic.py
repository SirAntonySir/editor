from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


class BwCinematicTemplate(FusedToolTemplate):
    id = "bw_cinematic"
    label = "B&W cinematic"
    description = "Black-and-white cinematic look — applies a fixed B&W LUT with a tunable tonal curve."
    typical_use = "Use when the user wants a cinematic black-and-white conversion."

    node_skeleton = [
        NodeSkeleton(
            node_type="lut",
            fixed_params={"lutId": "bw_cinematic"},
            tunable_param_keys=[],
        ),
        NodeSkeleton(
            node_type="curves", fixed_params={},
            tunable_param_keys=["points"],
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
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope: dict[str, ParamRange] = {}
    safety = {"skin_protect": False}
    context_inputs = ["contrast_p10_p90", "luma_histogram"]
