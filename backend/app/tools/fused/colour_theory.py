"""Colour-theory grades: complementary_grade, analogous_grade, monochrome_tint.

Both colour grades target HSL bands chosen by the colour-wheel relationship
they encode. `complementary_grade` pre-pins the classic orange↔blue pair (the
warm/cool axis that drives "teal-and-orange"-style grading). `analogous_grade`
pre-pins the warm red/orange/yellow trio. `monochrome_tint` desaturates and
applies a kelvin/tint colour wash.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class ComplementaryGradeTemplate(FusedToolTemplate):
    id = "complementary_grade"
    label = "Complementary grade"
    description = (
        "Push the classic orange↔blue complementary pair in HSL — warms reds "
        "and oranges, cools blues and aquas. Drives a teal-and-orange axis "
        "without committing to the full LUT."
    )
    typical_use = "User says 'complementary grade', 'orange and blue', 'warm-cool split', 'cinematic colour split'."

    node_skeleton = [
        NodeSkeleton(
            node_type="hsl", fixed_params={},
            tunable_param_keys=["orange_hue", "orange_sat", "blue_hue", "blue_sat"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="orange_hue", label="Orange hue", target_node_id="n_hsl"),
        slider(param_key="orange_sat", label="Orange saturation", target_node_id="n_hsl"),
        slider(param_key="blue_hue", label="Blue hue", target_node_id="n_hsl"),
        slider(param_key="blue_sat", label="Blue saturation", target_node_id="n_hsl"),
    ]
    param_envelope = {
        "orange_hue": envelope(min=-30, max=30, skin_safe_max=10),
        "orange_sat": envelope(min=-20, max=40, skin_safe_max=15),
        "blue_hue": envelope(min=-30, max=30),
        "blue_sat": envelope(min=-20, max=40),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["color_palette", "grade_character"]


class AnalogousGradeTemplate(FusedToolTemplate):
    id = "analogous_grade"
    label = "Analogous grade"
    description = (
        "Coordinated hue shift across the warm trio (red / orange / yellow) "
        "for an analogous colour grade. Subtle hue rotations only."
    )
    typical_use = "User says 'analogous grade', 'warm trio', 'unified warm tones', 'narrow palette'."

    node_skeleton = [
        NodeSkeleton(
            node_type="hsl", fixed_params={},
            tunable_param_keys=["red_hue", "orange_hue", "yellow_hue"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="red_hue", label="Red hue", target_node_id="n_hsl"),
        slider(param_key="orange_hue", label="Orange hue", target_node_id="n_hsl"),
        slider(param_key="yellow_hue", label="Yellow hue", target_node_id="n_hsl"),
    ]
    param_envelope = {
        "red_hue": envelope(min=-30, max=30, skin_safe_max=10),
        "orange_hue": envelope(min=-30, max=30, skin_safe_max=10),
        "yellow_hue": envelope(min=-30, max=30),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["color_palette", "grade_character"]


class MonochromeTintTemplate(FusedToolTemplate):
    id = "monochrome_tint"
    label = "Monochrome tint"
    description = (
        "Pin saturation to zero, then wash the image in a single hue via "
        "kelvin + tint. Sepia, blueprint, cyanotype variants live here."
    )
    typical_use = "User says 'sepia', 'cyanotype', 'tinted B&W', 'monochrome with colour wash'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={"saturation": -100},
            tunable_param_keys=[],
        ),
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature", "tint"],
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
    ]
    param_envelope = {
        "temperature": envelope(min=-2000, max=2000, step=50),
        "tint": envelope(min=-100, max=100),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["grade_character"]
