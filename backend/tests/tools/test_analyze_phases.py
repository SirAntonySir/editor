"""Unit tests for the pure phase functions. The no-mutation assertion is
the load-bearing test for Phase 2's #3 requirement."""

import numpy as np
import pytest

from app.schemas.image_context import CandidateRegion, ImageContext


@pytest.fixture
def simple_arr():
    return np.zeros((128, 128, 3), dtype=np.uint8)


@pytest.fixture
def simple_context():
    return ImageContext(
        subjects=["x"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood="m",
        candidate_regions=[
            CandidateRegion(
                label="r0",
                description="",
                bbox=[0.1, 0.1, 0.5, 0.5],
                representative_point=[0.3, 0.3],
            ),
        ],
        model_name="t",
        model_version="1",
        generated_at="2026-06-11T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_run_sam_embed_returns_true_on_success():
    from app.tools.atomic._analyze_phases import run_sam_embed

    class _Sam:
        def embed(self, _sid, _arr):
            return None

    ok = await run_sam_embed(_Sam(), "sid", np.zeros((4, 4, 3), dtype=np.uint8))
    assert ok is True


@pytest.mark.asyncio
async def test_run_sam_embed_returns_false_on_exception():
    from app.tools.atomic._analyze_phases import run_sam_embed

    class _Sam:
        def embed(self, _sid, _arr):
            raise RuntimeError("boom")

    ok = await run_sam_embed(_Sam(), "sid", np.zeros((4, 4, 3), dtype=np.uint8))
    assert ok is False


@pytest.mark.asyncio
async def test_run_sam_embed_returns_false_when_sam_is_none():
    from app.tools.atomic._analyze_phases import run_sam_embed

    ok = await run_sam_embed(None, "sid", np.zeros((4, 4, 3), dtype=np.uint8))
    assert ok is False


@pytest.mark.asyncio
async def test_decode_region_mask_returns_none_when_bbox_missing(simple_context):
    from app.tools.atomic._analyze_phases import decode_region_mask

    region = simple_context.candidate_regions[0].model_copy(update={"bbox": None})
    out = await decode_region_mask(None, "sid", 0, region, 100, 100)
    assert out is None


def test_build_enriched_grounds_problem_severities():
    """A conservatively-scored cast problem must be floored by the measured
    cast_strength, so the Info tab badge and the suggestion gate see the same
    grounded number."""
    from types import SimpleNamespace

    from app.schemas.enriched_context import Problem
    from app.state.context_stats import CheapPassResult
    from app.tools.atomic._analyze_phases import build_enriched

    base = ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="m",
        candidate_regions=[], model_name="t", model_version="1",
        generated_at="2026-06-11T00:00:00Z",
    )
    cheap = CheapPassResult(
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0, clipped_highlights_pct=0.0,
        median_luma=18.0, contrast_p10_p90=27.0,
        cast_strength=0.46, cast_direction=(11.0, -25.0),
    )
    soft = SimpleNamespace(
        estimated_white_point=(255.0, 255.0, 255.0),
        wb_neutral_confidence=0.1,
        grade_character="cool",
        problems=[Problem(kind="strong_color_cast", severity=0.35,
                          suggested_fused_tools=["cast_correct"])],
    )
    out = build_enriched(base, cheap, soft, [])
    assert out.problems[0].severity >= 0.6


def test_apply_region_masks_does_not_mutate_input():
    """The load-bearing no-mutation contract. Phase 2 fundamentally hinges
    on this — phase functions are pure, callers compose results."""
    from app.schemas.enriched_context import EnrichedImageContext
    from app.schemas.image_context import CandidateRegion
    from app.schemas.widget import MaskRecord
    from app.tools.atomic._analyze_phases import (
        RegionMaskResult, apply_region_masks,
    )

    enriched = EnrichedImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="m",
        candidate_regions=[
            CandidateRegion(
                label="r0", description="", bbox=[0.1, 0.1, 0.5, 0.5],
                representative_point=[0.3, 0.3],
            ),
        ],
        model_name="t", model_version="1", generated_at="2026-06-11T00:00:00Z",
    )
    original = enriched.model_dump()
    fake_mask = RegionMaskResult(
        region_index=0,
        mask_id="m1",
        mask_record=MaskRecord(
            id="m1", width=4, height=4, png_b64="X", source="sam_box", label="r0",
        ),
        mask_png_base64="X",
        paths=[[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
    )
    out = apply_region_masks(enriched, [fake_mask])
    # The input must be unchanged.
    assert enriched.model_dump() == original
    # The output must carry the mask.
    assert out.candidate_regions[0].mask_png_base64 == "X"
    assert out.candidate_regions[0].paths is not None
    assert len(out.candidate_regions[0].paths) == 1
