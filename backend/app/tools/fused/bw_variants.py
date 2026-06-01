"""Black-and-white variants: bw_high_contrast, bw_low_key.

Both pin `basic.saturation = -100` as a fixed param so the resolver can't
accidentally re-introduce colour. Tunables shape the tonal character on top of
the desaturated base. Complements the existing `bw_cinematic` LUT-based stock.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class BwHighContrastTemplate(FusedToolTemplate):
    id = "bw_high_contrast"
    label = "B&W high-contrast"
    description = (
        "High-contrast black-and-white — full desaturation plus aggressive "
        "contrast, deeper blacks, brighter whites."
    )
    typical_use = "User says 'high contrast B&W', 'punchy black and white', 'monochrome contrast'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={"saturation": -100},
            tunable_param_keys=["contrast", "blacks", "whites"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
        slider(param_key="blacks", label="Blacks", target_node_id="n_basic"),
        slider(param_key="whites", label="Whites", target_node_id="n_basic"),
    ]
    param_envelope = {
        "contrast": envelope(min=20, max=80),
        "blacks": envelope(min=-60, max=0),
        "whites": envelope(min=0, max=60),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "contrast_p10_p90"]


class BwLowKeyTemplate(FusedToolTemplate):
    id = "bw_low_key"
    label = "B&W low-key"
    description = (
        "Moody low-key black-and-white — full desaturation, dropped shadows, "
        "muted whites for a dark, brooding monochrome look."
    )
    typical_use = "User says 'low key B&W', 'moody black and white', 'dark monochrome'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={"saturation": -100},
            tunable_param_keys=["exposure", "shadows"],
        ),
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inWhite"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="exposure", label="Exposure", target_node_id="n_basic"),
        slider(param_key="shadows", label="Shadows", target_node_id="n_basic"),
        slider(
            param_key="inWhite", label="White point",
            target_node_id="n_levels", min=180, max=255, step=1,
        ),
    ]
    param_envelope = {
        "exposure": envelope(min=-40, max=0),
        "shadows": envelope(min=-60, max=0),
        "inWhite": envelope(min=200, max=255, step=1),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "grade_character"]
