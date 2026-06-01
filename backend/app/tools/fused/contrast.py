"""Contrast / detail templates: detail_pop, contrast_drop, levels_stretch.

`detail_pop` is a sharpen + clarity + contrast bundle for "more detail" prompts.
`contrast_drop` reduces global contrast and lifts the black point. `levels_stretch`
exposes the levels triplet (inBlack / inWhite / gamma) for explicit tonal
mapping — replaces the spec's `s_curve_pop` since the curves binding shape
doesn't cleanly fit the default numeric resolver.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class DetailPopTemplate(FusedToolTemplate):
    id = "detail_pop"
    label = "Detail pop"
    description = (
        "Bring out fine detail — coordinated sharpen + clarity + a touch of "
        "contrast. Use when the image looks soft or details need to read."
    )
    typical_use = "User says 'more detail', 'sharper', 'pop the detail', 'enhance texture'."

    node_skeleton = [
        NodeSkeleton(
            node_type="sharpen", fixed_params={},
            tunable_param_keys=["amount"],
        ),
        NodeSkeleton(
            node_type="clarity", fixed_params={},
            tunable_param_keys=["amount"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="sharpen_amount", label="Sharpen",
            target_node_id="n_sharpen", target_param_key="amount",
            min=0, max=100, step=1,
        ),
        slider(
            param_key="clarity_amount", label="Clarity",
            target_node_id="n_clarity", target_param_key="amount",
            min=0, max=100, step=1,
        ),
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
    ]
    param_envelope = {
        "sharpen_amount": envelope(min=10, max=80, step=1, skin_safe_max=30),
        "clarity_amount": envelope(min=10, max=80, step=1, skin_safe_max=30),
        "contrast": envelope(min=0, max=30, skin_safe_max=10),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["contrast_p10_p90", "luma_histogram"]


class ContrastDropTemplate(FusedToolTemplate):
    id = "contrast_drop"
    label = "Contrast drop"
    description = (
        "Reduce global contrast and lift the black point — softens an "
        "overly-punchy image."
    )
    typical_use = "User says 'too contrasty', 'soften contrast', 'lower contrast', 'less punch'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast"],
        ),
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inBlack"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
        slider(
            param_key="inBlack", label="Black point",
            target_node_id="n_levels", min=0, max=60, step=1,
        ),
    ]
    param_envelope = {
        "contrast": envelope(min=-60, max=0),
        "inBlack": envelope(min=0, max=40, step=1),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["contrast_p10_p90", "luma_histogram"]


class LevelsStretchTemplate(FusedToolTemplate):
    id = "levels_stretch"
    label = "Levels stretch"
    description = (
        "Explicit tonal map via levels — black point, white point, and gamma. "
        "Use when the user wants to remap the tonal range or fix exposure "
        "via the levels triplet rather than curves."
    )
    typical_use = "User says 'levels', 'remap blacks and whites', 'expand the tonal range'."

    node_skeleton = [
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inBlack", "inWhite", "gamma"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="inBlack", label="Black point",
            target_node_id="n_levels", min=0, max=255, step=1,
        ),
        slider(
            param_key="inWhite", label="White point",
            target_node_id="n_levels", min=0, max=255, step=1,
        ),
        slider(
            param_key="gamma", label="Gamma",
            target_node_id="n_levels", min=0.1, max=3.0, step=0.01,
        ),
    ]
    param_envelope = {
        "inBlack": envelope(min=0, max=80, step=1),
        "inWhite": envelope(min=180, max=255, step=1),
        "gamma": envelope(min=0.5, max=2.0, step=0.01),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "contrast_p10_p90"]
