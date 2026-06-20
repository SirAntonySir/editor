"""analyze_context: produces EnrichedImageContext, no mask precompute, no widgets."""

import pytest

from app.tools.atomic.analyze_context import AnalyzeContextTool, _Input
from tests.contract._fixtures import fake_anthropic, fake_sam  # noqa: F401


@pytest.mark.asyncio
async def test_analyze_context_returns_enriched(make_doc, fake_anthropic, monkeypatch):
    """The tool returns an EnrichedImageContext with regions, soft fields,
    and region_stats — but NOT mask paths or mask_png_base64 (precompute
    is a separate tool now)."""
    monkeypatch.setenv("ANALYZE_SAM", "0")
    # make_doc bypasses the session store — stub set_context so it doesn't
    # raise SessionNotFound when the tool tries to persist the enriched context.
    from unittest.mock import MagicMock
    from app.api import deps as _deps
    monkeypatch.setattr(_deps, "get_session_store", lambda: MagicMock(set_context=MagicMock()))
    doc = make_doc()
    from pathlib import Path
    img = Path(__file__).parent.parent / "fixtures" / "test_image.jpg"
    doc.image_bytes = img.read_bytes()

    out = await AnalyzeContextTool().handler(doc, _Input())
    assert out.candidate_regions is not None
    assert len(out.candidate_regions) >= 1
    # No precompute → regions have no paths/png.
    for r in out.candidate_regions:
        assert r.mask_png_base64 is None
        assert r.paths is None
    # Soft fields and region_stats present.
    assert out.grade_character is not None


@pytest.mark.asyncio
async def test_analyze_context_short_circuits_on_cached_doc(make_doc, fake_anthropic, monkeypatch):
    """Re-running on a doc that already has EnrichedImageContext returns
    the cached value without calling Claude again."""
    from app.schemas.enriched_context import EnrichedImageContext
    from app.schemas.image_context import CandidateRegion

    monkeypatch.setenv("ANALYZE_SAM", "0")
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    doc = make_doc()
    cached = EnrichedImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="m",
        candidate_regions=[
            CandidateRegion(label="r0", description="", bbox=[0.0, 0.0, 1.0, 1.0]),
        ],
        model_name="cached", model_version="1", generated_at="2026-06-11T00:00:00Z",
        grade_character="cached-grade",
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, cached)
    out = await AnalyzeContextTool().handler(doc, _Input())
    assert out.grade_character == "cached-grade"
    assert out.candidate_regions[0].label == "r0"
