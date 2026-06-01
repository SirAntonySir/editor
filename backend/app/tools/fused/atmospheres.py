"""Time-of-day atmospheres: golden_hour, blue_hour, overcast, foggy.

Each is a coordinated WB + tonal grade keyed to a lighting story. Default
resolver picks the numeric values from `kelvin`, `basic`, and `levels` nodes.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class GoldenHourTemplate(FusedToolTemplate):
    id = "golden_hour"
    label = "Golden hour"
    description = (
        "Warm golden-hour glow — push kelvin toward warm, lift shadows, boost "
        "saturation slightly. Evokes late-afternoon sun."
    )
    typical_use = "User says 'golden hour', 'sunset glow', 'warm afternoon light'."

    node_skeleton = [
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["shadows", "saturation"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="temperature", label="Warmth",
            target_node_id="n_kelvin",
            min=-2000, max=2000, step=50, unit="K",
        ),
        slider(param_key="shadows", label="Shadows", target_node_id="n_basic"),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
    ]
    param_envelope = {
        "temperature": envelope(min=200, max=1500, step=50, skin_safe_max=600),
        "shadows": envelope(min=0, max=50),
        "saturation": envelope(min=0, max=30, skin_safe_max=10),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["estimated_white_point", "grade_character", "luma_histogram"]


class BlueHourTemplate(FusedToolTemplate):
    id = "blue_hour"
    label = "Blue hour"
    description = (
        "Cool blue-hour twilight — push kelvin cool, deepen shadows, boost "
        "saturation. Evokes pre-dawn / dusk."
    )
    typical_use = "User says 'blue hour', 'twilight', 'pre-dawn', 'evening cool'."

    node_skeleton = [
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["shadows", "saturation"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="temperature", label="Coolness",
            target_node_id="n_kelvin",
            min=-2000, max=2000, step=50, unit="K",
        ),
        slider(param_key="shadows", label="Shadows", target_node_id="n_basic"),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
    ]
    param_envelope = {
        "temperature": envelope(min=-1500, max=-200, step=50, skin_safe_max=-300),
        "shadows": envelope(min=-50, max=0),
        "saturation": envelope(min=0, max=30, skin_safe_max=10),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["estimated_white_point", "grade_character", "luma_histogram"]


class OvercastTemplate(FusedToolTemplate):
    id = "overcast"
    label = "Overcast"
    description = (
        "Overcast diffuse-sky look — drop saturation, drop contrast. "
        "The flat-grey-day softness."
    )
    typical_use = "User says 'overcast', 'cloudy', 'grey day', 'diffused light'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast", "saturation"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
    ]
    param_envelope = {
        "contrast": envelope(min=-40, max=0),
        "saturation": envelope(min=-40, max=0),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "contrast_p10_p90", "grade_character"]


class FoggyTemplate(FusedToolTemplate):
    id = "foggy"
    label = "Foggy"
    description = (
        "Foggy atmospheric haze — lift the blacks (clouded shadows) and push "
        "kelvin slightly cool. Evokes mist."
    )
    typical_use = "User says 'foggy', 'misty', 'hazy atmosphere'."

    node_skeleton = [
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inBlack"],
        ),
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="inBlack", label="Lifted blacks",
            target_node_id="n_levels", min=0, max=60, step=1,
        ),
        slider(
            param_key="temperature", label="Coolness",
            target_node_id="n_kelvin",
            min=-2000, max=2000, step=50, unit="K",
        ),
    ]
    param_envelope = {
        "inBlack": envelope(min=10, max=60, step=1),
        "temperature": envelope(min=-800, max=-100, step=50, skin_safe_max=-200),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "grade_character"]
