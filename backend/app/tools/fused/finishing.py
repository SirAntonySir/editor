"""Finishing / polish templates: tinted_grade, micro_contrast.

`tinted_grade` replaces the spec's `split_toning` — the curves-per-channel
shape that split toning needs isn't a clean fit for the default numeric
resolver, so we expose a kelvin-tint + saturation grade instead, which serves
the same "subtle global colour cast on a desaturated base" intent for most
prompts. `micro_contrast` is the single-knob clarity polish.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class TintedGradeTemplate(FusedToolTemplate):
    id = "tinted_grade"
    label = "Tinted grade"
    description = (
        "Subtle tinted grade — small kelvin shift plus a green/magenta tint "
        "with reduced saturation. The colourist's 'just a touch of colour' polish."
    )
    typical_use = "User says 'subtle tint', 'colour cast for mood', 'gentle grade', 'splash of colour'."

    node_skeleton = [
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature", "tint"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["saturation"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="temperature", label="Warmth",
            target_node_id="n_kelvin",
            min=-2000, max=2000, step=50, unit="K",
        ),
        slider(
            param_key="tint", label="Tint",
            target_node_id="n_kelvin", min=-100, max=100, step=1,
        ),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
    ]
    param_envelope = {
        "temperature": envelope(min=-800, max=800, step=50, skin_safe_max=300),
        "tint": envelope(min=-30, max=30, skin_safe_max=10),
        "saturation": envelope(min=-30, max=0),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "color_palette"]


class MicroContrastTemplate(FusedToolTemplate):
    id = "micro_contrast"
    label = "Micro contrast"
    description = (
        "Single-knob local-contrast polish via clarity. Adds (or removes) "
        "midtone definition without the full sharpen + contrast bundle."
    )
    typical_use = "User says 'micro contrast', 'local contrast', 'clarity', 'a bit more definition'."

    node_skeleton = [
        NodeSkeleton(
            node_type="clarity", fixed_params={},
            tunable_param_keys=["amount"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="amount", label="Clarity",
            target_node_id="n_clarity",
            min=0, max=100, step=1,
        ),
    ]
    param_envelope = {
        "amount": envelope(min=0, max=80, step=1, skin_safe_max=30),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["contrast_p10_p90", "grade_character"]
