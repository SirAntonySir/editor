"""Ground LLM-assigned problem severities in the mechanical cheap-pass.

The augment LLM scores problem severity conservatively — on the 2026-07-10
boat stimulus a cast_strength of 0.46 (objectively heavy) was scored 0.35,
under the 0.4 suggestion gate, so the corrective suggestion never minted while
aesthetic grades did.

This module raises the severity of *already-detected* problems to a floor
derived from the measurable evidence, for the problem kinds that HAVE
measurable evidence. It is deliberately one-directional and conservative:

  - it never invents a problem (only the LLM's list is grounded);
  - it never lowers a severity (`max(llm, floor)`);
  - kinds without a mechanical signal (soft_focus, distracting_element,
    dull_subject, skin_tone_shift, noisy_shadows, uneven_white_balance,
    other) are passed through untouched.

Units (see `compute_cheap_pass`): `clipped_*_pct` are PERCENT (0..100),
`median_luma` / region `mean_luma` / `contrast_p10_p90` are 0..255,
`cast_strength` is 0..1.
"""

from __future__ import annotations

from app.schemas.enriched_context import Problem, RegionStats
from app.state.context_stats import CheapPassResult

# Severities never exceed this via grounding — a mechanical floor expresses
# "clearly worth fixing", not certainty; leave headroom for the LLM to have
# scored something even higher on judgment.
_MAX_FLOOR = 0.9


def _cast_floor(cast_strength: float) -> float:
    # 0.46 (boat) → 0.64; 0.29 → 0.40 (the gate); saturates at _MAX_FLOOR.
    return min(_MAX_FLOOR, cast_strength * 1.4)


def _clip_floor(clip_pct: float) -> float:
    # Percent of frame clipped. ~5.5% → gate; ~8% → _MAX_FLOOR.
    return min(_MAX_FLOOR, (clip_pct / 8.0) * _MAX_FLOOR)


def _low_contrast_floor(contrast_p10_p90: float) -> float:
    # A healthy frame spans ~100+ between p10 and p90. Narrower → rising.
    if contrast_p10_p90 >= 100.0:
        return 0.0
    return min(_MAX_FLOOR, (100.0 - contrast_p10_p90) / 100.0 * _MAX_FLOOR)


def _underexposure_floor(mean_luma: float) -> float:
    # Target mid ~115/255. Darker → rising; ~73 → gate, ≤20 → _MAX_FLOOR.
    target = 115.0
    if mean_luma >= target:
        return 0.0
    return min(_MAX_FLOOR, (target - mean_luma) / target * 1.1)


def _overexposure_floor(mean_luma: float) -> float:
    target = 140.0
    if mean_luma <= target:
        return 0.0
    return min(_MAX_FLOOR, (mean_luma - target) / (255.0 - target) * 1.1)


def ground_problem_severities(
    problems: list[Problem],
    cheap: CheapPassResult,
    region_stats: list[RegionStats],
) -> list[Problem]:
    """Return a new problem list with measurable-kind severities floored by the
    mechanical evidence. Input problems are not mutated."""
    by_label = {r.label: r for r in region_stats}
    grounded: list[Problem] = []
    for p in problems:
        floor = 0.0
        if p.kind == "strong_color_cast":
            floor = _cast_floor(cheap.cast_strength)
        elif p.kind == "crushed_shadows":
            floor = _clip_floor(cheap.clipped_shadows_pct)
        elif p.kind == "clipped_highlights":
            floor = _clip_floor(cheap.clipped_highlights_pct)
        elif p.kind == "low_contrast":
            floor = _low_contrast_floor(cheap.contrast_p10_p90)
        elif p.kind in ("local_underexposure", "local_overexposure"):
            region = by_label.get(p.region_label or "")
            if region is not None:
                floor = (
                    _underexposure_floor(region.mean_luma)
                    if p.kind == "local_underexposure"
                    else _overexposure_floor(region.mean_luma)
                )

        if floor > p.severity:
            grounded.append(p.model_copy(update={"severity": floor}))
        else:
            grounded.append(p)
    return grounded
