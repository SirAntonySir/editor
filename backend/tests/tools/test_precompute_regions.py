"""precompute_regions: SAM box-decode, no mutation, MaskRecords registered."""

import numpy as np
import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.image_context import CandidateRegion
from app.state.context_stats import CheapPassResult
from app.state.document import DEFAULT_IMAGE_NODE_ID
from app.tools.atomic._analyze_phases import PrepareResult
from app.tools.atomic.precompute_regions import PrecomputeRegionsTool, _Input


def _cheap() -> CheapPassResult:
    return CheapPassResult(
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0,
        clipped_highlights_pct=0.0,
        median_luma=0.5,
        contrast_p10_p90=1.0,
        color_palette=[],
        cast_strength=0.0,
        cast_direction=(0.0, 0.0),
    )


def _enriched_with_one_region() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="m",
        candidate_regions=[
            CandidateRegion(
                label="r0", description="", bbox=[0.1, 0.1, 0.5, 0.5],
                representative_point=[0.3, 0.3],
            ),
        ],
        model_name="t", model_version="1", generated_at="2026-06-11T00:00:00Z",
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0, clipped_highlights_pct=0.0,
        median_luma=0.5, contrast_p10_p90=1.0, color_palette=[], cast_strength=0.0,
        cast_direction=(0.0, 0.0), region_stats=[],
        estimated_white_point=(255.0, 255.0, 255.0),
        wb_neutral_confidence=1.0, grade_character="neutral", problems=[],
    )


@pytest.mark.asyncio
async def test_precompute_regions_writes_paths(make_doc, monkeypatch):
    """The region in doc.image_context gets mask_png_base64 + paths after."""
    monkeypatch.setenv("ANALYZE_SAM", "1")

    class _Sam:
        def decode_box(self, _sid, pixel_bbox):
            x1, y1, x2, y2 = pixel_bbox.astype(int)
            h = max(int(y2) + 1, 4)
            w = max(int(x2) + 1, 4)
            mask = np.zeros((h, w), dtype=bool)
            mask[y1:y2, x1:x2] = True
            return mask

    monkeypatch.setattr("app.api.deps.get_sam_client", lambda: _Sam())
    # The session store set_context call needs a real or stubbed store.
    from unittest.mock import MagicMock
    monkeypatch.setattr("app.api.deps.get_session_store", lambda: MagicMock())

    doc = make_doc()
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _enriched_with_one_region())
    doc.set_prepare_result(DEFAULT_IMAGE_NODE_ID, PrepareResult(
        cheap=_cheap(), sam_ok=True, image_width=100, image_height=100,
    ))

    out = await PrecomputeRegionsTool().handler(doc, _Input())
    assert len(out.mask_ids) == 1
    # Region now carries paths + png — applied via model_copy, no in-place edit.
    updated_ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
    assert updated_ctx.candidate_regions[0].paths is not None
    assert updated_ctx.candidate_regions[0].mask_png_base64 is not None


@pytest.mark.asyncio
async def test_precompute_regions_returns_empty_when_sam_off(make_doc, monkeypatch):
    """If prepare_result.sam_ok is False (SAM disabled or failed), no masks."""
    monkeypatch.setenv("ANALYZE_SAM", "0")
    doc = make_doc()
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _enriched_with_one_region())
    doc.set_prepare_result(DEFAULT_IMAGE_NODE_ID, PrepareResult(
        cheap=_cheap(), sam_ok=False, image_width=100, image_height=100,
    ))
    out = await PrecomputeRegionsTool().handler(doc, _Input())
    assert out.mask_ids == []


@pytest.mark.asyncio
async def test_precompute_regions_returns_empty_when_no_context(make_doc):
    """If doc.image_context is not EnrichedImageContext (e.g. analyze_context
    hasn't run yet), the tool returns empty without trying SAM."""
    doc = make_doc()
    out = await PrecomputeRegionsTool().handler(doc, _Input())
    assert out.mask_ids == []
