"""Tonal mood grades: moody, dreamy, vintage, matte_film, gritty.

Each picks a coordinated set of scalar tweaks across the basic / levels / hsl /
sharpen / clarity nodes. Uses the default resolver — pure data definitions.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class MoodyTemplate(FusedToolTemplate):
    id = "moody"
    label = "Moody"
    description = (
        "Moody, brooding look — drop exposure, raise contrast, desaturate, "
        "and pull the shadows down slightly."
    )
    typical_use = "User says 'moody', 'brooding', 'darker mood', 'cinematic darkness'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["exposure", "contrast", "shadows", "saturation"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="exposure", label="Exposure", target_node_id="n_basic"),
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
        slider(param_key="shadows", label="Shadows", target_node_id="n_basic"),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
    ]
    param_envelope = {
        "exposure": envelope(min=-50, max=10, skin_safe_max=5),
        "contrast": envelope(min=0, max=70, skin_safe_max=30),
        "shadows": envelope(min=-60, max=0),
        "saturation": envelope(min=-50, max=10, skin_safe_max=10),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "luma_histogram", "contrast_p10_p90"]


class DreamyTemplate(FusedToolTemplate):
    id = "dreamy"
    label = "Dreamy"
    description = (
        "Soft dreamy look — lift shadows, soften highlights, drop contrast and "
        "saturation slightly, negative clarity for a hazy feel."
    )
    typical_use = "User says 'dreamy', 'soft', 'hazy', 'ethereal', 'fairytale'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["exposure", "shadows", "highlights", "saturation"],
        ),
        NodeSkeleton(
            node_type="clarity", fixed_params={},
            tunable_param_keys=["amount"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="exposure", label="Exposure", target_node_id="n_basic"),
        slider(param_key="shadows", label="Shadows", target_node_id="n_basic"),
        slider(param_key="highlights", label="Highlights", target_node_id="n_basic"),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
        slider(
            param_key="clarity_amount", label="Clarity",
            target_node_id="n_clarity", target_param_key="amount",
        ),
    ]
    param_envelope = {
        "exposure": envelope(min=0, max=30, skin_safe_max=10),
        "shadows": envelope(min=0, max=70),
        "highlights": envelope(min=-60, max=0),
        "saturation": envelope(min=-40, max=0),
        "clarity_amount": envelope(min=-100, max=0),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "luma_histogram"]


class VintageTemplate(FusedToolTemplate):
    id = "vintage"
    label = "Vintage"
    description = (
        "Vintage film look — lifted blacks, slightly muted whites, desaturated "
        "palette with warm red/yellow hue rotation."
    )
    typical_use = "User says 'vintage', 'retro', '70s', 'old film', 'nostalgic'."

    node_skeleton = [
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inBlack", "inWhite"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["saturation"],
        ),
        NodeSkeleton(
            node_type="hsl", fixed_params={},
            tunable_param_keys=["red_hue", "yellow_hue"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="inBlack", label="Black point",
            target_node_id="n_levels", min=0, max=80, step=1,
        ),
        slider(
            param_key="inWhite", label="White point",
            target_node_id="n_levels", min=180, max=255, step=1,
        ),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
        slider(param_key="red_hue", label="Red hue", target_node_id="n_hsl"),
        slider(param_key="yellow_hue", label="Yellow hue", target_node_id="n_hsl"),
    ]
    param_envelope = {
        "inBlack": envelope(min=0, max=80, step=1),
        "inWhite": envelope(min=180, max=255, step=1),
        "saturation": envelope(min=-50, max=0),
        "red_hue": envelope(min=-40, max=40, skin_safe_max=15),
        "yellow_hue": envelope(min=-40, max=40),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "color_palette"]


class MatteFilmTemplate(FusedToolTemplate):
    id = "matte_film"
    label = "Matte film"
    description = (
        "Flat matte film stock — lifted blacks, dropped whites, gentle contrast "
        "reduction. The classic faded-print look."
    )
    typical_use = "User says 'matte', 'faded', 'flat film', 'low contrast film'."

    node_skeleton = [
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inBlack", "inWhite"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast"],
        ),
    ]
    bindings_skeleton = [
        slider(
            param_key="inBlack", label="Black point",
            target_node_id="n_levels", min=0, max=60, step=1,
        ),
        slider(
            param_key="inWhite", label="White point",
            target_node_id="n_levels", min=200, max=255, step=1,
        ),
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
    ]
    param_envelope = {
        "inBlack": envelope(min=0, max=60, step=1),
        "inWhite": envelope(min=200, max=255, step=1),
        "contrast": envelope(min=-50, max=0),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "contrast_p10_p90"]


class GrittyTemplate(FusedToolTemplate):
    id = "gritty"
    label = "Gritty"
    description = (
        "Gritty hard-edged look — strong contrast, desaturated palette, heavy "
        "sharpen and positive clarity for visible texture."
    )
    typical_use = "User says 'gritty', 'raw', 'hard', 'documentary', 'textured'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast", "saturation"],
        ),
        NodeSkeleton(
            node_type="sharpen", fixed_params={},
            tunable_param_keys=["amount"],
        ),
        NodeSkeleton(
            node_type="clarity", fixed_params={},
            tunable_param_keys=["amount"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
        slider(param_key="saturation", label="Saturation", target_node_id="n_basic"),
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
    ]
    param_envelope = {
        "contrast": envelope(min=20, max=80, skin_safe_max=40),
        "saturation": envelope(min=-60, max=10),
        "sharpen_amount": envelope(min=20, max=100, step=1, skin_safe_max=40),
        "clarity_amount": envelope(min=20, max=100, step=1, skin_safe_max=40),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "contrast_p10_p90"]
