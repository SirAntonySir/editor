"""Severity grounding — floor LLM-assigned problem severities with the
mechanical cheap-pass evidence, so an objectively-severe defect can't slip
under the suggestion gate on a conservative LLM score. Grounding never invents
a problem and never lowers a severity."""

from __future__ import annotations

from app.schemas.enriched_context import Problem, RegionStats
from app.services.severity_grounding import ground_problem_severities
from app.state.context_stats import CheapPassResult


def _cheap(**over) -> CheapPassResult:
    base = dict(
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0,
        clipped_highlights_pct=0.0,
        median_luma=120.0,
        contrast_p10_p90=140.0,
        cast_strength=0.0,
        cast_direction=(0.0, 0.0),
    )
    base.update(over)
    return CheapPassResult(**base)


def _region(label: str, mean_luma: float) -> RegionStats:
    return RegionStats(
        label=label,
        pixel_count=1000,
        mean_luma=mean_luma,
        mean_rgb=(mean_luma, mean_luma, mean_luma),
        is_skin_likely=False,
        is_sky_likely=False,
        saturation_mean=0.0,
        contrast_p10_p90=100.0,
    )


def _problem(kind: str, severity: float, **over) -> Problem:
    return Problem(kind=kind, severity=severity, suggested_fused_tools=["x"], **over)


# ---- cast --------------------------------------------------------------


def test_strong_cast_floored_above_gate_for_measured_cast():
    # Boat stimulus: cast_strength 0.46, LLM said 0.35. Must ground past 0.4.
    out = ground_problem_severities(
        [_problem("strong_color_cast", 0.35)], _cheap(cast_strength=0.46), []
    )
    assert out[0].severity >= 0.6


def test_no_cast_evidence_leaves_cast_severity_untouched():
    out = ground_problem_severities(
        [_problem("strong_color_cast", 0.3)], _cheap(cast_strength=0.0), []
    )
    assert out[0].severity == 0.3


# ---- underexposure (region-matched) ------------------------------------


def test_local_underexposure_floored_from_region_mean_luma():
    # Boat "sea" region very dark → floor clears the gate.
    out = ground_problem_severities(
        [_problem("local_underexposure", 0.4, region_label="sea")],
        _cheap(),
        [_region("sea", 20.0)],
    )
    assert out[0].severity >= 0.5


def test_underexposure_without_matching_region_is_untouched():
    out = ground_problem_severities(
        [_problem("local_underexposure", 0.3, region_label="sky")],
        _cheap(),
        [_region("sea", 20.0)],
    )
    assert out[0].severity == 0.3


# ---- invariants --------------------------------------------------------


def test_grounding_never_lowers_severity():
    out = ground_problem_severities(
        [_problem("strong_color_cast", 0.9)], _cheap(cast_strength=0.1), []
    )
    assert out[0].severity == 0.9


def test_judgment_only_kind_is_never_grounded():
    out = ground_problem_severities(
        [_problem("soft_focus", 0.2, region_label="sea")],
        _cheap(cast_strength=0.9, median_luma=5.0),
        [_region("sea", 5.0)],
    )
    assert out[0].severity == 0.2


def test_original_image_keeps_mild_problem_below_gate():
    # A neutral, well-exposed frame: any mild LLM problem stays sub-gate.
    out = ground_problem_severities(
        [_problem("strong_color_cast", 0.15)],
        _cheap(cast_strength=0.08, median_luma=118.0, contrast_p10_p90=150.0),
        [],
    )
    assert out[0].severity < 0.4


def test_returns_new_objects_does_not_mutate_input():
    original = _problem("strong_color_cast", 0.35)
    ground_problem_severities([original], _cheap(cast_strength=0.46), [])
    assert original.severity == 0.35


def test_clipped_highlights_floored_from_clip_percent():
    out = ground_problem_severities(
        [_problem("clipped_highlights", 0.2)],
        _cheap(clipped_highlights_pct=6.0),
        [],
    )
    assert out[0].severity >= 0.5


def test_low_contrast_floored_from_narrow_spread():
    out = ground_problem_severities(
        [_problem("low_contrast", 0.2)], _cheap(contrast_p10_p90=27.0), []
    )
    assert out[0].severity >= 0.5
