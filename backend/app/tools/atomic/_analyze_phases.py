"""Pure phase functions for the analyze pipeline.

Each function takes inputs, returns outputs, and never mutates a SessionDocument
or pydantic model that lives outside its own scope. This is the cleanup that
makes the 4-tool split possible: tools wire phases together, phases compute.
"""

from __future__ import annotations

import asyncio
import io
import uuid
from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.api.analyze import _mask_to_paths
from app.schemas.enriched_context import EnrichedImageContext, RegionStats
from app.schemas.image_context import CandidateRegion, ImageContext
from app.schemas.widget import MaskRecord
from app.state.context_stats import CheapPassResult, compute_cheap_pass
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.atomic.select_by_point import _encode_mask_png_b64


@dataclass(frozen=True)
class PrepareResult:
    """Output of prepare_image: cheap mechanical stats + SAM embed status."""

    cheap: CheapPassResult
    sam_ok: bool
    image_width: int
    image_height: int


@dataclass(frozen=True)
class RegionMaskResult:
    """One pre-decoded SAM mask for a candidate region."""

    region_index: int
    mask_id: str
    mask_record: MaskRecord
    mask_png_base64: str
    paths: list[list[list[float]]]


def decode_image(image_bytes: bytes) -> tuple[np.ndarray, int, int]:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.asarray(img)
    return arr, arr.shape[1], arr.shape[0]


async def run_mechanical(arr: np.ndarray) -> CheapPassResult:
    """Cheap pass (cv2/numpy) on the source pixels. CPU-bound but fast."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, compute_cheap_pass, arr)


async def run_sam_embed(sam, session_id: str, arr: np.ndarray) -> bool:
    """SAM image-encoder pass. Returns True on success, False on failure."""
    if sam is None:
        return False
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, sam.embed, session_id, arr)
        return True
    except Exception:
        return False


async def decode_region_mask(
    sam,
    session_id: str,
    region_index: int,
    region: CandidateRegion,
    w_img: int,
    h_img: int,
) -> RegionMaskResult | None:
    """Run SAM box-decode for ONE region. Returns None on failure or missing bbox."""
    if region.bbox is None:
        return None

    x, y, w, h = region.bbox
    pixel_bbox = np.array(
        [x * w_img, y * h_img, (x + w) * w_img, (y + h) * h_img], dtype=np.float32
    )
    loop = asyncio.get_running_loop()
    try:
        mask = await loop.run_in_executor(
            None, lambda: sam.decode_box(session_id, pixel_bbox),
        )
    except Exception:
        return None
    mask_id = str(uuid.uuid4())
    png_b64 = _encode_mask_png_b64(mask)
    record = MaskRecord(
        id=mask_id,
        width=int(mask.shape[1]),
        height=int(mask.shape[0]),
        png_b64=png_b64,
        source="sam_box",
        label=region.label,
        image_node_id=DEFAULT_IMAGE_NODE_ID,
    )
    return RegionMaskResult(
        region_index=region_index,
        mask_id=mask_id,
        mask_record=record,
        mask_png_base64=png_b64,
        paths=_mask_to_paths(mask),
    )


def build_enriched(
    base: ImageContext,
    cheap: CheapPassResult,
    soft,
    region_stats: list[RegionStats],
) -> EnrichedImageContext:
    """Compose the EnrichedImageContext from pure inputs. No mutation: the
    caller owns the result; this function returns it."""
    return EnrichedImageContext(
        **base.model_dump(),
        luma_histogram=cheap.luma_histogram,
        rgb_histograms=cheap.rgb_histograms,
        clipped_shadows_pct=cheap.clipped_shadows_pct,
        clipped_highlights_pct=cheap.clipped_highlights_pct,
        median_luma=cheap.median_luma,
        contrast_p10_p90=cheap.contrast_p10_p90,
        color_palette=cheap.color_palette,
        cast_strength=cheap.cast_strength,
        cast_direction=cheap.cast_direction,
        region_stats=region_stats,
        estimated_white_point=soft.estimated_white_point,
        wb_neutral_confidence=soft.wb_neutral_confidence,
        grade_character=soft.grade_character,
        problems=soft.problems,
    )


def apply_region_masks(
    enriched: EnrichedImageContext,
    masks: list[RegionMaskResult],
) -> EnrichedImageContext:
    """Apply pre-decoded mask paths + PNG onto the regions. Returns a NEW
    EnrichedImageContext — does NOT mutate the input.

    The PNG and paths are mirrored onto `candidate_regions[i]` so the
    frontend's object-mode pipeline can read them directly (it does not
    pull from masks_index).
    """
    by_index = {m.region_index: m for m in masks}
    new_regions = []
    for i, r in enumerate(enriched.candidate_regions):
        m = by_index.get(i)
        if m is None:
            new_regions.append(r.model_copy())
            continue
        new_regions.append(
            r.model_copy(
                update={"mask_png_base64": m.mask_png_base64, "paths": m.paths},
            ),
        )
    return enriched.model_copy(update={"candidate_regions": new_regions})


def compute_region_stats(arr: np.ndarray, base: ImageContext, soft_fields) -> list[RegionStats]:
    """Run the region-stats computation. Pure wrapper that delegates to the
    dedicated module."""
    from app.state.region_stats import compute_region_stats as _impl

    return _impl(arr, base, soft_fields)
