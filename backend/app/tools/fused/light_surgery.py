"""Per-channel light surgery: lift_shadows, deepen_blacks, recover_highlights,
contrast_punch.

Targeted single-concern tools for common prompts about specific tonal regions.
All use the default resolver — pure data.
"""
from __future__ import annotations

from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton
from app.tools.fused._helpers import envelope, slider


class LiftShadowsTemplate(FusedToolTemplate):
    id = "lift_shadows"
    label = "Lift shadows"
    description = (
        "Open up blocked-up shadows — positive `shadows` and `blacks`. Use "
        "when shadow detail is hidden in the dark."
    )
    typical_use = "User says 'shadows are blocked', 'open up shadows', 'lift the darks', 'too dark'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["shadows", "blacks"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="shadows", label="Shadows", target_node_id="n_basic"),
        slider(param_key="blacks", label="Blacks", target_node_id="n_basic"),
    ]
    param_envelope = {
        "shadows": envelope(min=0, max=80),
        "blacks": envelope(min=0, max=60),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "clipped_shadows_pct"]


class DeepenBlacksTemplate(FusedToolTemplate):
    id = "deepen_blacks"
    label = "Deepen blacks"
    description = (
        "Drop the darkest tones for more punch — negative `blacks` plus a "
        "small positive `inBlack` from levels to crush slightly."
    )
    typical_use = "User says 'deepen blacks', 'crush shadows', 'darker blacks', 'more punch in shadows'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["blacks"],
        ),
        NodeSkeleton(
            node_type="levels", fixed_params={},
            tunable_param_keys=["inBlack"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="blacks", label="Blacks", target_node_id="n_basic"),
        slider(
            param_key="inBlack", label="Levels black point",
            target_node_id="n_levels", min=0, max=60, step=1,
        ),
    ]
    param_envelope = {
        "blacks": envelope(min=-80, max=0),
        "inBlack": envelope(min=0, max=40, step=1),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "clipped_shadows_pct"]


class RecoverHighlightsTemplate(FusedToolTemplate):
    id = "recover_highlights"
    label = "Recover highlights"
    description = (
        "Pull back blown highlights — negative `highlights` and `whites`. "
        "Generic, not sky-specific (see `sky_recovery` for that)."
    )
    typical_use = "User says 'recover highlights', 'blown out', 'too bright', 'tone down brights'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["highlights", "whites"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="highlights", label="Highlights", target_node_id="n_basic"),
        slider(param_key="whites", label="Whites", target_node_id="n_basic"),
    ]
    param_envelope = {
        "highlights": envelope(min=-80, max=0),
        "whites": envelope(min=-60, max=0),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["luma_histogram", "clipped_highlights_pct"]


class ContrastPunchTemplate(FusedToolTemplate):
    id = "contrast_punch"
    label = "Contrast punch"
    description = (
        "Generic contrast boost — positive contrast plus a small "
        "blacks/whites push for extra depth on flat images."
    )
    typical_use = "User says 'more contrast', 'flat needs depth', 'punchier', 'more punch'."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast", "blacks", "whites"],
        ),
    ]
    bindings_skeleton = [
        slider(param_key="contrast", label="Contrast", target_node_id="n_basic"),
        slider(param_key="blacks", label="Blacks", target_node_id="n_basic"),
        slider(param_key="whites", label="Whites", target_node_id="n_basic"),
    ]
    param_envelope = {
        "contrast": envelope(min=10, max=70, skin_safe_max=30),
        "blacks": envelope(min=-40, max=0),
        "whites": envelope(min=0, max=40),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": True}
    context_inputs = ["contrast_p10_p90", "luma_histogram"]
