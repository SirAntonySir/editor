import pytest
from pydantic import ValidationError

from app.schemas.enriched_context import (
    ColorSwatch,
    EnrichedImageContext,
    Problem,
    RegionStats,
)


def test_color_swatch_rgb_and_weight() -> None:
    s = ColorSwatch(rgb=(255, 100, 50), weight=0.4)
    assert s.weight == 0.4


def test_problem_required_fields() -> None:
    p = Problem(
        kind="clipped_highlights", severity=0.7, region_label=None, bbox=None,
        suggested_fused_tools=["sky_recovery"],
    )
    assert p.kind == "clipped_highlights"


def test_problem_kind_rejects_unknown() -> None:
    with pytest.raises(ValidationError):
        Problem(kind="brokenz", severity=0.5, suggested_fused_tools=[])


def test_region_stats_round_trip() -> None:
    rs = RegionStats(
        label="sky", pixel_count=1000,
        mean_luma=200.0,
        luma_histogram=[0] * 32,
        mean_rgb=(150.0, 180.0, 220.0),
        dominant_swatches=[ColorSwatch(rgb=(150, 180, 220), weight=1.0)],
        is_skin_likely=False, is_sky_likely=True,
        saturation_mean=0.4, contrast_p10_p90=80.0,
    )
    assert RegionStats.model_validate(rs.model_dump()) == rs


def test_enriched_image_context_extends_v1(sample_image_context) -> None:
    enriched = {
        **sample_image_context,
        "luma_histogram": [0] * 256,
        "rgb_histograms": {"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        "clipped_shadows_pct": 0.0,
        "clipped_highlights_pct": 0.0,
        "median_luma": 128.0,
        "contrast_p10_p90": 100.0,
        "color_palette": [],
        "cast_strength": 0.0,
        "cast_direction": (0.0, 0.0),
        "region_stats": [],
        "estimated_white_point": (255.0, 255.0, 255.0),
        "wb_neutral_confidence": 0.5,
        "grade_character": "neutral",
        "problems": [],
    }
    ctx = EnrichedImageContext.model_validate(enriched)
    assert ctx.subjects == sample_image_context["subjects"]
    assert ctx.grade_character == "neutral"
