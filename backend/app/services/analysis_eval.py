"""Reusable evaluation of the mechanical analysis + severity grounding.

Shared by the CI eval tier (tests/eval) and the manual harness
(scripts/eval-analysis.py). Given a decoded RGB image, it reports the
cheap-pass signals plus the mechanical severity FLOOR each measurable problem
kind would receive — i.e. what grounding contributes independent of any LLM
score. A floor >= the suggestion gate means the mechanical evidence alone is
enough to surface that problem.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.schemas.enriched_context import Problem, RegionStats
from app.services.autonomous_suggestions import SEVERITY_GATE as SEVERITY_GATE_DEFAULT
from app.services.severity_grounding import ground_problem_severities
from app.state.context_stats import CheapPassResult, compute_cheap_pass

__all__ = ["EvalReport", "evaluate_rgb", "floors_from_cheap", "SEVERITY_GATE_DEFAULT"]

# Measurable kinds probed by the eval. local_underexposure is probed with a
# whole-frame region so a single image yields a floor without candidate regions.
_WHOLE_IMAGE_KINDS = (
    "strong_color_cast", "crushed_shadows", "clipped_highlights", "low_contrast",
)
_FRAME_REGION = "frame"


@dataclass(frozen=True)
class EvalReport:
    cast_strength: float
    cast_direction: tuple[float, float]
    median_luma: float
    clipped_shadows_pct: float
    clipped_highlights_pct: float
    contrast_p10_p90: float
    floors: dict[str, float]


def floors_from_cheap(cheap: CheapPassResult) -> dict[str, float]:
    """The mechanical severity floor each measurable kind would receive, if the
    LLM had emitted it at severity 0. Uses a whole-frame region to probe
    local_underexposure/overexposure."""
    frame = RegionStats(
        label=_FRAME_REGION, pixel_count=1, mean_luma=cheap.median_luma,
        mean_rgb=(cheap.median_luma,) * 3, is_skin_likely=False, is_sky_likely=False,
        saturation_mean=0.0, contrast_p10_p90=cheap.contrast_p10_p90,
    )
    probes = [
        Problem(kind=k, severity=0.0, suggested_fused_tools=[])
        for k in _WHOLE_IMAGE_KINDS
    ]
    probes += [
        Problem(kind=k, severity=0.0, region_label=_FRAME_REGION,
                suggested_fused_tools=[])
        for k in ("local_underexposure", "local_overexposure")
    ]
    grounded = ground_problem_severities(probes, cheap, [frame])
    return {p.kind: p.severity for p in grounded}


def evaluate_rgb(image_rgb: np.ndarray) -> EvalReport:
    """Run the cheap pass on a uint8 RGB array and report signals + floors."""
    cheap = compute_cheap_pass(image_rgb)
    return EvalReport(
        cast_strength=cheap.cast_strength,
        cast_direction=cheap.cast_direction,
        median_luma=cheap.median_luma,
        clipped_shadows_pct=cheap.clipped_shadows_pct,
        clipped_highlights_pct=cheap.clipped_highlights_pct,
        contrast_p10_p90=cheap.contrast_p10_p90,
        floors=floors_from_cheap(cheap),
    )
