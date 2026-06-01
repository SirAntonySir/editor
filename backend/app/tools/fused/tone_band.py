"""Per-band HSL fused templates: tone_red … tone_magenta.

Each instance targets one of the eight HSL bands and exposes three sliders
(Hue / Sat / Lum) bound to that band's `<band>_<channel>` params on a single
`hsl` node. Designed so the LLM picker can route prompts like "green tones are
not good" or "desaturate the reds" to the correct band template.

Frontend `HslWidgetBody` detects single-band widgets (one unique `<band>_*`
prefix in the bindings) and renders the colour-aware `HslSingleBandView`.
"""
from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
)


_CHANNELS = ("hue", "sat", "lum")

# Synonyms surface in the picker description so the model latches on
# user-spoken colour words ("greens", "lime", "olive") rather than just the
# canonical band name.
_BAND_SYNONYMS: dict[str, list[str]] = {
    "red":     ["red", "reds", "reddish", "ruddy"],
    "orange":  ["orange", "oranges", "amber", "ginger", "peach"],
    "yellow":  ["yellow", "yellows", "gold", "mustard", "sallow"],
    "green":   ["green", "greens", "greenish", "lime", "olive"],
    "aqua":    ["aqua", "cyan", "teal-leaning", "teal"],
    "blue":    ["blue", "blues", "bluish", "navy", "indigo"],
    "purple":  ["purple", "violet", "lavender", "plum"],
    "magenta": ["magenta", "pink", "fuchsia"],
}

# Skin-prone bands get a conservative skin_safe clamp on hue + sat so a
# skin-likely scope can't push them aggressively.
_SKIN_PRONE = {"red", "orange"}


class ToneBandTemplate(FusedToolTemplate):
    """One HSL band's Hue/Sat/Lum sliders. Subclass-by-instance: `band` is the
    only parameter, all other fields derive from it."""

    def __init__(self, band: str) -> None:
        if band not in _BAND_SYNONYMS:
            raise ValueError(f"Unknown HSL band: {band!r}")
        synonyms = ", ".join(_BAND_SYNONYMS[band])
        self.id = f"tone_{band}"
        self.label = f"Adjust {band} tones"
        self.description = (
            f"Shift the {band} colour family in HSL space — covers {synonyms}. "
            f"Tunes hue / saturation / luminance for that band only."
        )
        self.typical_use = (
            f"User says '{band} tones are off', 'too much {band}', "
            f"'desaturate the {band}s', or names any synonym above."
        )

        tunable_keys = [f"{band}_{c}" for c in _CHANNELS]
        self.node_skeleton = [
            NodeSkeleton(
                node_type="hsl",
                fixed_params={},
                tunable_param_keys=tunable_keys,
            )
        ]

        self.bindings_skeleton = [
            BindingSkeleton(
                param_key=f"{band}_hue",
                label="Hue",
                control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -100, "max": 100, "step": 1}
                ),
                target=NodeParamTarget(node_id="n_hsl", param_key=f"{band}_hue"),
                tunable_default=True,
            ),
            BindingSkeleton(
                param_key=f"{band}_sat",
                label="Saturation",
                control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -100, "max": 100, "step": 1}
                ),
                target=NodeParamTarget(node_id="n_hsl", param_key=f"{band}_sat"),
                tunable_default=True,
            ),
            BindingSkeleton(
                param_key=f"{band}_lum",
                label="Luminance",
                control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -100, "max": 100, "step": 1}
                ),
                target=NodeParamTarget(node_id="n_hsl", param_key=f"{band}_lum"),
                tunable_default=True,
            ),
        ]

        skin_safe = band in _SKIN_PRONE
        self.param_envelope = {
            f"{band}_hue": ParamRange(
                min=-100, max=100, step=1,
                skin_safe_max=30 if skin_safe else None,
            ),
            f"{band}_sat": ParamRange(
                min=-100, max=100, step=1,
                skin_safe_max=30 if skin_safe else None,
            ),
            f"{band}_lum": ParamRange(min=-100, max=100, step=1),
        }

        self.preview = {"kind": "thumbnail", "auto_before_after": True}
        self.requires_scope = "any"
        self.safety = {"skin_protect": skin_safe}
        self.context_inputs = ["color_palette", "region_stats", "grade_character"]


def all_tone_band_templates() -> list[ToneBandTemplate]:
    return [ToneBandTemplate(b) for b in _BAND_SYNONYMS]
