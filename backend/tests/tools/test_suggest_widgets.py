"""suggest_widgets: fires the autonomous fan-out, returns new widget IDs."""

import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.tools.atomic.suggest_widgets import SuggestWidgetsTool, _Input
from tests.contract._fixtures import fake_anthropic  # noqa: F401


def _enriched_stub() -> EnrichedImageContext:
    """Minimal EnrichedImageContext with no problems and neutral character.
    The fake_anthropic fixture stubs suggest_fused_tools_for_character → []
    so no widgets are minted — exercises the happy path without LLM cost."""
    return EnrichedImageContext(
        subjects=["subject"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood="neutral",
        candidate_regions=[],
        model_name="claude-haiku-4-5-test",
        model_version="test",
        generated_at="2026-01-01T00:00:00Z",
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0,
        clipped_highlights_pct=0.0,
        median_luma=0.5,
        contrast_p10_p90=1.0,
        color_palette=[],
        cast_strength=0.0,
        cast_direction=(0.0, 0.0),
        region_stats=[],
        estimated_white_point=(255.0, 255.0, 255.0),
        wb_neutral_confidence=1.0,
        grade_character="neutral",
        problems=[],
    )


@pytest.mark.asyncio
async def test_suggest_widgets_returns_empty_when_suggest_canned_empty(
    make_doc, fake_anthropic,
):
    """With the canned fake_anthropic returning [] for suggest_fused, the
    tool completes without minting anything — exercises the happy path
    without real LLM cost."""
    doc = make_doc()
    doc.image_context = _enriched_stub()
    out = await SuggestWidgetsTool().handler(doc, _Input())
    assert out.widget_ids == []


@pytest.mark.asyncio
async def test_suggest_widgets_returns_empty_when_no_context(make_doc):
    """If doc.image_context is not EnrichedImageContext, tool short-circuits."""
    doc = make_doc()  # without_image_context default
    out = await SuggestWidgetsTool().handler(doc, _Input())
    assert out.widget_ids == []
