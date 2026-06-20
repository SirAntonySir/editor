"""Strip the heavy, binary, and numeric blobs from `image_context` before
shipping it to an LLM call.

The `EnrichedImageContext` schema is shared between three runtimes:
the backend computes and stores it, the frontend renders it (histograms,
swatches, region thumbnails), and a subset is fed to the LLM as
grounding for fused-tool resolution.

The third consumer wants almost none of what the first two need.
Specifically these fields are large and useless to a language model:

  - ``candidate_regions[*].mask_png_base64`` — base64 PNG strings of the
    SAM mask, ~10 KB each. The frontend uses them to render the region
    overlay; the LLM cannot read PNG bytes.
  - ``candidate_regions[*].paths`` — the polygon coordinates that mirror
    the same mask. Hundreds of [x, y] floats per region. The LLM gets
    spatial information from ``bbox`` already.
  - ``luma_histogram`` (256 ints), ``rgb_histograms`` (256 × 3 ints) —
    pre-computed for the Info-panel plots. The LLM has access to
    ``median_luma``, ``contrast_p10_p90``, and ``clipped_*_pct``, which
    are the actionable summary of the same data.
  - ``region_stats[*].luma_histogram`` (32 ints per region) — same
    reasoning, per region.

For the underwater-fish session in the telemetry trace these fields
added up to ~28k tokens per prompt — 96 % of every resolver call's
input. Removing them cuts a $0.85-per-prompt session to ~$0.10.

The fields the LLM *does* want — subjects, lighting, mood, dominant
tones, grade_character, problems, region labels with bboxes — survive
untouched.
"""
from __future__ import annotations

from typing import Any

# Top-level keys of EnrichedImageContext that are too large and have
# nothing the LLM can act on. The LLM still sees the *summary* of these
# (median_luma, contrast_p10_p90, clipped_shadows_pct, clipped_highlights_pct)
# which are smaller flat numbers.
#
# Both case forms are listed because the dict reaches this helper in
# whichever case the caller used — ``ctx.model_dump(by_alias=True)``
# emits camelCase (the wire shape) while internal Python dicts stay in
# snake_case. The wire-shape migration that introduced
# ``camel_config(populate_by_name=True)`` means both forms are live
# simultaneously; matching only one would silently let the other slip
# through.
_TOP_LEVEL_DROP = frozenset({
    "luma_histogram",  "lumaHistogram",
    "rgb_histograms",  "rgbHistograms",
    "region_stats",    "regionStats",
})

# Per-region keys that carry binary or pixel-coordinate data. The LLM
# already sees `bbox` and `representative_point` for spatial grounding.
_REGION_DROP = frozenset({
    "mask_png_base64",  "maskPngBase64",
    "paths",
})


def image_context_for_llm(ctx: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a shallow copy of `ctx` with the heavy / non-LLM-actionable
    fields removed. ``None`` passes through unchanged so callers can
    pre-analyze sessions without a special case.

    Pure: does not mutate the input. Output is suitable for ``str()``
    embedding into a Claude prompt block.
    """
    if ctx is None:
        return None
    out: dict[str, Any] = {k: v for k, v in ctx.items() if k not in _TOP_LEVEL_DROP}
    regions = out.get("candidate_regions") or out.get("candidateRegions")
    if isinstance(regions, list):
        slim_regions = [
            {k: v for k, v in r.items() if k not in _REGION_DROP}
            if isinstance(r, dict)
            else r
            for r in regions
        ]
        # Preserve whichever case the caller used; both keys exist because
        # the wire-shape camelCase migration left snake-case readable
        # internally and camelCase on the wire.
        if "candidateRegions" in out:
            out["candidateRegions"] = slim_regions
        else:
            out["candidate_regions"] = slim_regions
    return out
