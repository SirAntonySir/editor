"""Verify that a corrective suggestion actually corrects.

After a corrective widget's params are resolved, they are applied through the
CPU preview approximation and the cheap pass is recomputed. `verify_correction`
compares the problem's OWN mechanical metric before vs after and reports
whether it moved far enough in the right direction.

Verification never blocks a suggestion — the caller uses a failed result to
retry once with feedback, then surfaces the better attempt regardless. A
problem whose metric can't be judged (a judgement-only kind, or clipping with
nothing meaningful clipped to begin with) is reported `verifiable=False` and
left alone.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.enriched_context import Problem
from app.schemas.widget import Widget
from app.state.context_stats import CheapPassResult, compute_cheap_pass
from app.state.preview_renderer import render_widget_effect_arrays

# Relative drop required to call a cast/clipping correction an improvement.
_CAST_IMPROVE_RATIO = 0.8
_CLIP_IMPROVE_RATIO = 0.75
# Absolute luma move (0..255) required for exposure / contrast corrections.
_LUMA_IMPROVE_DELTA = 15.0
# Below this, a clipping metric is too small to verify recovery against.
_CLIP_MIN_BEFORE_PCT = 0.5
# Exposure "toward mid" target band.
_MID_LOW, _MID_HIGH = 90.0, 140.0


@dataclass(frozen=True)
class VerificationResult:
    verifiable: bool
    improved: bool
    metric: str
    before: float
    after: float


def _unverifiable(metric: str) -> VerificationResult:
    return VerificationResult(verifiable=False, improved=False, metric=metric,
                              before=0.0, after=0.0)


def verify_correction(
    problem: Problem,
    before: CheapPassResult,
    after: CheapPassResult,
) -> VerificationResult:
    kind = problem.kind

    if kind in ("strong_color_cast", "uneven_white_balance"):
        b, a = before.cast_strength, after.cast_strength
        if b <= 0.0:
            return _unverifiable("cast_strength")
        return VerificationResult(True, a <= b * _CAST_IMPROVE_RATIO,
                                  "cast_strength", b, a)

    if kind == "clipped_highlights":
        b, a = before.clipped_highlights_pct, after.clipped_highlights_pct
        if b < _CLIP_MIN_BEFORE_PCT:
            return _unverifiable("clipped_highlights_pct")
        return VerificationResult(True, a <= b * _CLIP_IMPROVE_RATIO,
                                  "clipped_highlights_pct", b, a)

    if kind == "crushed_shadows":
        b, a = before.clipped_shadows_pct, after.clipped_shadows_pct
        if b < _CLIP_MIN_BEFORE_PCT:
            return _unverifiable("clipped_shadows_pct")
        return VerificationResult(True, a <= b * _CLIP_IMPROVE_RATIO,
                                  "clipped_shadows_pct", b, a)

    if kind == "low_contrast":
        b, a = before.contrast_p10_p90, after.contrast_p10_p90
        return VerificationResult(True, a >= b + _LUMA_IMPROVE_DELTA,
                                  "contrast_p10_p90", b, a)

    if kind in ("local_underexposure", "local_overexposure"):
        b, a = before.median_luma, after.median_luma
        if kind == "local_underexposure":
            improved = a >= b + _LUMA_IMPROVE_DELTA and a <= _MID_HIGH + _LUMA_IMPROVE_DELTA
        else:
            improved = a <= b - _LUMA_IMPROVE_DELTA and a >= _MID_LOW - _LUMA_IMPROVE_DELTA
        return VerificationResult(True, improved, "median_luma", b, a)

    return _unverifiable("none")


def measure_and_verify(
    problem: Problem,
    image_bytes: bytes,
    mime_type: str,
    widget: Widget,
    max_dim: int = 512,
) -> VerificationResult | None:
    """Apply `widget` to a downscaled copy of the image via the CPU preview,
    recompute the cheap pass before and after, and verify the correction.

    Returns None when the widget can't be CPU-approximated (unsupported node
    type) — the caller skips verification for it rather than blocking.
    """
    arrays = render_widget_effect_arrays(image_bytes, mime_type, widget, max_dim)
    if arrays is None:
        return None
    before_arr, after_arr = arrays
    return verify_correction(
        problem, compute_cheap_pass(before_arr), compute_cheap_pass(after_arr)
    )
