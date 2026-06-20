"""Tests for `image_context_for_llm` — the LLM-prompt slimmer.

Pins the contract that the function strips specifically the heavy /
non-LLM-actionable fields and *only* those, on both the snake_case
internal shape and the camelCase wire shape. Without this guard a
schema addition that accidentally lands a new big field (e.g. a new
mask format) would slip through and reintroduce the 28 k-token
resolver-call regression we just fixed.
"""
from __future__ import annotations

from app.services.llm_context import image_context_for_llm


def _fat_context_snake() -> dict:
    """Realistic shape — mirrors the fish-aquarium session in telemetry."""
    return {
        "subjects": ["royal gramma fish", "coral reef"],
        "lighting": "side",
        "dominant_tones": ["shadows", "midtones"],
        "mood": "vibrant, serene",
        "candidate_regions": [
            {
                "label": "royal gramma fish",
                "description": "Brightly colored fish in centre frame",
                "bbox": [0.18, 0.26, 0.6, 0.34],
                "representative_point": [0.5, 0.42],
                "paths": [[[0.1, 0.2], [0.3, 0.4]] * 50],   # ~100 floats
                "mask_png_base64": "iVBORw0KGgo" + "A" * 12000,  # ~12k char png
            },
            {
                "label": "coral reef",
                "description": "Out-of-focus rocks",
                "bbox": [0.0, 0.45, 1.0, 0.55],
                "representative_point": [0.45, 0.85],
                "paths": [[[0.0, 0.0]] * 200],
                "mask_png_base64": "iVBORw0KGgo" + "A" * 15000,
            },
        ],
        "grade_character": "cool-cinematic",
        "problems": [
            {"kind": "crushed_shadows", "severity": 0.45, "region_label": "water"},
        ],
        "median_luma": 88,
        "contrast_p10_p90": 74,
        "clipped_shadows_pct": 1.2,
        "clipped_highlights_pct": 0.0,
        # Heavy numerical blobs that the LLM cannot act on:
        "luma_histogram": list(range(256)),
        "rgb_histograms": {"r": list(range(256)), "g": list(range(256)), "b": list(range(256))},
        "region_stats": [
            {
                "label": "royal gramma fish",
                "pixel_count": 142448,
                "mean_luma": 68.8,
                "luma_histogram": list(range(32)),
                "mean_rgb": [92.3, 58.5, 64.3],
                "saturation_mean": 0.68,
                "contrast_p10_p90": 114,
                "is_skin_likely": False,
                "is_sky_likely": False,
                "dominant_swatches": [],
            },
        ],
    }


def _fat_context_camel() -> dict:
    """Same as the snake variant but in camelCase — the shape that comes
    off `ctx.model_dump(by_alias=True)` and lands in propose_stack."""
    return {
        "subjects": ["fish"],
        "lighting": "side",
        "dominantTones": ["shadows"],
        "mood": "vibrant",
        "candidateRegions": [
            {
                "label": "fish",
                "description": "Centre frame",
                "bbox": [0.1, 0.1, 0.5, 0.5],
                "representativePoint": [0.3, 0.3],
                "paths": [[[0.1, 0.2]] * 100],
                "maskPngBase64": "iVBORw0KGgo" + "B" * 10000,
            },
        ],
        "gradeCharacter": "neutral",
        "problems": [],
        "lumaHistogram": list(range(256)),
        "rgbHistograms": {"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        "regionStats": [
            {"label": "fish", "pixelCount": 10, "lumaHistogram": list(range(32))},
        ],
    }


class TestStripsHeavyFields:
    def test_drops_top_level_histograms_and_region_stats(self):
        out = image_context_for_llm(_fat_context_snake())
        assert "luma_histogram" not in out
        assert "rgb_histograms" not in out
        assert "region_stats" not in out

    def test_drops_per_region_mask_and_paths(self):
        out = image_context_for_llm(_fat_context_snake())
        for r in out["candidate_regions"]:
            assert "mask_png_base64" not in r
            assert "paths" not in r

    def test_works_on_camel_case_too(self):
        """propose_stack passes ctx.model_dump(by_alias=True) — camelCase."""
        out = image_context_for_llm(_fat_context_camel())
        assert "lumaHistogram" not in out
        assert "rgbHistograms" not in out
        assert "regionStats" not in out
        for r in out["candidateRegions"]:
            assert "maskPngBase64" not in r
            assert "paths" not in r


class TestKeepsLLMActionableFields:
    """The whole point is that the LLM can still ground its answer on
    the useful narrative + summary numbers. Pin every survivor by name."""

    def test_keeps_narrative_fields(self):
        out = image_context_for_llm(_fat_context_snake())
        assert out["subjects"] == ["royal gramma fish", "coral reef"]
        assert out["lighting"] == "side"
        assert out["dominant_tones"] == ["shadows", "midtones"]
        assert out["mood"] == "vibrant, serene"
        assert out["grade_character"] == "cool-cinematic"
        assert out["problems"][0]["kind"] == "crushed_shadows"

    def test_keeps_per_region_label_and_bbox(self):
        out = image_context_for_llm(_fat_context_snake())
        r = out["candidate_regions"][0]
        assert r["label"] == "royal gramma fish"
        assert r["description"].startswith("Brightly colored")
        assert r["bbox"] == [0.18, 0.26, 0.6, 0.34]
        assert r["representative_point"] == [0.5, 0.42]

    def test_keeps_summary_numerics(self):
        """median_luma + contrast + clipped_*_pct are the *summary* of the
        histograms we just dropped. They're what the LLM can act on."""
        out = image_context_for_llm(_fat_context_snake())
        assert out["median_luma"] == 88
        assert out["contrast_p10_p90"] == 74
        assert out["clipped_shadows_pct"] == 1.2


class TestEdgeCases:
    def test_none_passes_through(self):
        """smart_match passes None when no analyze has run."""
        assert image_context_for_llm(None) is None

    def test_does_not_mutate_input(self):
        """We share the dict across plan + N resolver calls; mutation in
        one slimmer call would corrupt the others."""
        ctx = _fat_context_snake()
        before_keys = set(ctx.keys())
        before_region_keys = set(ctx["candidate_regions"][0].keys())
        image_context_for_llm(ctx)
        assert set(ctx.keys()) == before_keys
        assert set(ctx["candidate_regions"][0].keys()) == before_region_keys
        assert "luma_histogram" in ctx  # still there on original

    def test_empty_dict(self):
        assert image_context_for_llm({}) == {}

    def test_missing_regions(self):
        """Some early-bird sessions have no candidate_regions yet."""
        out = image_context_for_llm({"subjects": ["x"], "lighting": "flat"})
        assert out == {"subjects": ["x"], "lighting": "flat"}


class TestRealWorldTokenCutdown:
    """The reason this helper exists. If a future change makes the slim
    context as large as the original, every comment about cost in the
    PR is a lie — fail loudly so the reviewer notices."""

    def test_strips_at_least_90_percent_of_fat_context(self):
        fat = _fat_context_snake()
        slim = image_context_for_llm(fat)
        fat_len = len(str(fat))
        slim_len = len(str(slim))
        # Fat fixture is ~30 KB; slim should be ~1 KB.
        assert slim_len < fat_len * 0.1, (
            f"Slim context is {slim_len} chars vs fat {fat_len} chars — "
            f"the slimmer no longer slims. Did someone add a heavy field?"
        )
