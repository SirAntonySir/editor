import base64
import io
import logging
import os

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel

from app.schemas.image_context import (
    CandidateRegion,
    ImageContext,
    RegionLabel,
    RegionRefinement,
    SamPromptSet,
)
from app.services.anthropic_client import AnthropicClient
from app.services.sam_client import SamClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

logger = logging.getLogger(__name__)

router = APIRouter()

# Douglas-Peucker simplification tolerance, as a fraction of the image's longer
# side. ~0.15% gives polygons of a few dozen points for typical masks — small
# enough to serialize cheaply, dense enough to preserve recognisable shape.
_POLY_EPSILON_FRAC = 0.0015
# Drop any contour smaller than this many pixels — SAM occasionally produces
# stray single-pixel components on edges.
_MIN_CONTOUR_AREA = 50.0
# Per-region noise filter: keep the largest polygon and any additional
# polygon whose area is at least this fraction of the largest. Without it,
# regions like "church facade lower" emit 30+ tiny polygons (holes between
# windows, between bricks), all rendered as overlay outlines. Disjoint
# pieces of comparable size — e.g. sky split by a tall tower — survive
# because they sit well above the threshold.
_MIN_POLY_AREA_FRAC = 0.25

# Feature flag: run the Claude-driven pass-2 refinement (annotated composite
# review + per-region accept/refine/drop + re-run SAM with richer prompts).
# Currently disabled by default — empirically the refinement step has been
# bloating masks in crowded scenes by adding bbox-spanning positive points
# Claude inferred from the annotated overview. Set ANALYZE_REFINE=1 to re-enable.
def _refine_enabled() -> bool:
    return os.environ.get("ANALYZE_REFINE", "0") not in ("0", "", "false", "False")


# Feature flag: pre-segment every candidate region during /analyze (run SAM
# per region, attach paths + mask_png_base64). Default off — the new chip
# workflow creates masks on-demand from user clicks, so /analyze only needs to
# return labels + bbox + representative_point. Saves SAM time + bytes on every
# analyse. Set ANALYZE_PRESEGMENT=1 to re-enable the legacy pre-segmentation.
def _presegment_enabled() -> bool:
    return os.environ.get("ANALYZE_PRESEGMENT", "0") not in ("0", "", "false", "False")


class AnalyzeRequest(BaseModel):
    session_id: str


def _decode_image_rgb(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img)


def _mask_centroid_normalised(mask: np.ndarray) -> tuple[float, float] | None:
    """Return the [x, y] centroid of the mask in normalised 0–1 coords.

    Guaranteed to land *inside* the mask: if the geometric mean falls outside
    a non-convex shape (e.g. a ring or an L), falls back to the masked pixel
    nearest to the geometric mean. Returns None if the mask is empty.

    Used to overwrite Claude's pre-SAM `representative_point` after refinement
    so the visual anchor on the AI palette always reflects where the actual
    mask is, not Claude's pre-segmentation guess.
    """
    h, w = mask.shape[:2]
    if h == 0 or w == 0:
        return None
    mask_bool = mask.astype(bool) if mask.dtype != bool else mask
    ys, xs = np.where(mask_bool)
    if xs.size == 0:
        return None
    cx = float(xs.mean())
    cy = float(ys.mean())
    ix = max(0, min(w - 1, int(round(cx))))
    iy = max(0, min(h - 1, int(round(cy))))
    if not bool(mask_bool[iy, ix]):
        # Non-convex shape: snap to the nearest masked pixel.
        distances_sq = (xs - cx) ** 2 + (ys - cy) ** 2
        idx = int(np.argmin(distances_sq))
        cx = float(xs[idx])
        cy = float(ys[idx])
    return cx / w, cy / h


def _mask_to_png_base64(mask: np.ndarray) -> str:
    """Encode a boolean / 0–255 mask as a 1-channel PNG and return base64.

    The frontend decodes this directly into a Uint8Array — no polygon
    rasterisation, no lossy contour extraction.
    """
    mask_u8 = (mask.astype(np.uint8)) * 255 if mask.dtype == bool else mask.astype(np.uint8)
    ok, buf = cv2.imencode(".png", mask_u8)
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _mask_to_paths(mask: np.ndarray) -> list[list[list[float]]]:
    """Convert a boolean SAM mask into a list of normalised-coordinate polygons.

    Uses cv2.findContours (external contours only, no holes) followed by
    Douglas-Peucker simplification. Coordinates are normalised to 0–1 against
    the mask's own dimensions so the frontend can rescale to any preview size.
    Polygons are filtered twice: first by absolute area (`_MIN_CONTOUR_AREA`),
    then relative to the largest polygon in the mask (`_MIN_POLY_AREA_FRAC`).
    The relative pass collapses noisy per-region clutter — e.g. a facade
    region whose mask has 30+ small holes between architectural details — to
    its dominant connected component(s).
    """
    h, w = mask.shape[:2]
    mask_u8 = (mask.astype(np.uint8)) * 255 if mask.dtype == bool else mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    epsilon = max(1.0, _POLY_EPSILON_FRAC * max(w, h))
    candidates: list[tuple[float, list[list[float]]]] = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < _MIN_CONTOUR_AREA:
            continue
        simplified = cv2.approxPolyDP(c, epsilon, closed=True)
        if len(simplified) < 3:
            continue
        poly = [[float(p[0][0]) / w, float(p[0][1]) / h] for p in simplified]
        candidates.append((area, poly))
    if not candidates:
        return []
    max_area = max(area for area, _ in candidates)
    threshold = max_area * _MIN_POLY_AREA_FRAC
    # Sort by area descending so the dominant polygon always comes first —
    # matters for the frontend tooltip / centroid logic which currently
    # takes the first polygon of a region.
    candidates.sort(key=lambda t: -t[0])
    return [poly for area, poly in candidates if area >= threshold]


def _denormalise_point(p: list[float], w: int, h: int) -> tuple[float, float]:
    """Convert a [x, y] in normalised 0–1 coords (with tolerance) to pixel coords.
    Values outside [0, 1] are passed through unchanged on the assumption Claude
    occasionally emits already-denormalised coords."""
    x, y = p
    if 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
        return x * w, y * h
    return x, y


def _sam_decode_for_prompts(
    sam: SamClient,
    sid: str,
    prompts: SamPromptSet,
    w: int,
    h: int,
) -> np.ndarray | None:
    """Run SAM with the given prompt set (positive + negative points, optional bbox).
    Returns the mask or None if SAM rejects or produces empty output."""
    points: list[list[float]] = []
    labels: list[float] = []
    for p in prompts.positive_points:
        x, y = _denormalise_point(p, w, h)
        points.append([x, y])
        labels.append(1.0)
    for p in prompts.negative_points:
        x, y = _denormalise_point(p, w, h)
        points.append([x, y])
        labels.append(0.0)
    box = None
    if prompts.bbox:
        bx, by, bw, bh = prompts.bbox
        if 0.0 <= bx <= 1.0 and 0.0 <= bw <= 1.0:
            bx, by, bw, bh = bx * w, by * h, bw * w, bh * h
        box = np.array([bx, by, bx + bw, by + bh], dtype=np.float32)
    if not points and box is None:
        return None
    try:
        mask = sam.decode_combined(
            sid,
            points=np.array(points, dtype=np.float32) if points else None,
            labels=np.array(labels, dtype=np.float32) if points else None,
            box=box,
        )
    except (RuntimeError, ValueError):
        return None
    return mask if mask is not None and mask.any() else None


def _render_annotated_composite(
    image_rgb: np.ndarray,
    masks: list[np.ndarray],
) -> bytes:
    """Render the original image with each mask outlined in a distinct color and
    labeled with its 1-based index. Sent to Claude in the refinement pass so it
    can review per-region segmentation visually."""
    out = image_rgb.copy()
    h, w = out.shape[:2]
    thickness = max(2, int(min(h, w) * 0.005))
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.6, min(h, w) / 900.0)
    text_thickness = max(1, int(font_scale * 2))
    for i, mask in enumerate(masks):
        if mask is None or not mask.any():
            continue
        # Distinct hue per index; cv2 HSV hue range 0–180.
        hue = (i * 23 + 7) % 180
        hsv = np.array([[[hue, 220, 240]]], dtype=np.uint8)
        rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)[0, 0].tolist()
        color = tuple(int(c) for c in rgb)
        contours, _ = cv2.findContours(
            (mask.astype(np.uint8)) * 255,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_NONE,
        )
        cv2.drawContours(out, contours, -1, color, thickness)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            M = cv2.moments(largest)
            if M["m00"] > 0:
                cx = int(M["m10"] / M["m00"])
                cy = int(M["m01"] / M["m00"])
                text = str(i + 1)
                (tw, th), _ = cv2.getTextSize(text, font, font_scale, text_thickness)
                pad = max(4, int(font_scale * 6))
                cv2.rectangle(
                    out,
                    (cx - tw // 2 - pad, cy - th - pad),
                    (cx + tw // 2 + pad, cy + pad),
                    color,
                    -1,
                )
                cv2.putText(
                    out,
                    text,
                    (cx - tw // 2, cy),
                    font,
                    font_scale,
                    (0, 0, 0),
                    text_thickness,
                    cv2.LINE_AA,
                )
    pil = Image.fromarray(out)
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _refine_regions(
    context: ImageContext,
    image_rgb: np.ndarray,
    sam: SamClient,
    anthropic: AnthropicClient,
    sid: str,
) -> None:
    """Two-pass region refinement:

    Pass 1: run SAM for every region using its initial Claude-supplied prompts
            (bbox + representative_point, combined when both available).
    Pass 2: render an annotated composite (original + colored mask outlines +
            numbered labels) and ask Claude to accept / refine / drop each
            region. For `refine`, re-run SAM with the richer prompt set Claude
            supplies (bbox + multiple positive/negative points).
    Final:  convert each surviving mask to polygon paths on the CandidateRegion.

    Regions Claude marks `drop`, plus those where SAM fails outright, are
    discarded from the response.
    """
    if not context.candidate_regions:
        return
    sam.embed(sid, image_rgb)
    h, w = image_rgb.shape[:2]
    logger.info("[analyze] image_dims=%dx%d (WxH), n_regions=%d", w, h, len(context.candidate_regions))

    # --- Pass 1: initial SAM segmentation per region -----------------------
    valid_regions: list[CandidateRegion] = []
    pass1_masks: list[np.ndarray] = []
    for region in context.candidate_regions:
        logger.info(
            "[analyze] region=%-30r bbox=%s rep_point=%s",
            region.label,
            region.bbox,
            region.representative_point,
        )
        if region.representative_point is None:
            continue
        prompts = SamPromptSet(
            bbox=region.bbox,
            positive_points=[list(region.representative_point)],
        )
        mask = _sam_decode_for_prompts(sam, sid, prompts, w, h)
        if mask is None:
            continue
        valid_regions.append(region)
        pass1_masks.append(mask)

    if not valid_regions:
        context.candidate_regions = []
        return

    # --- Pass 2: Claude reviews the annotated composite --------------------
    # Gated by ANALYZE_REFINE env var. When off, the refinement step is
    # skipped entirely (no extra Claude call, no extra SAM decode) and pass-1
    # masks are used as the final masks.
    ref_by_idx: dict[int, RegionRefinement] = {}
    if _refine_enabled():
        try:
            composite = _render_annotated_composite(image_rgb, pass1_masks)
            refinements = anthropic.refine_image_context(
                annotated_image=composite,
                mime_type="image/jpeg",
                regions=valid_regions,
                session_id=sid,
            )
            ref_by_idx = {r.region_index - 1: r for r in refinements.refinements}
        except Exception as err:
            # If the refinement call fails for any reason, fall back to pass-1
            # masks rather than dropping the whole analyse — graceful degradation.
            logger.warning("[analyze] refinement pass failed, using pass-1 masks: %s", err)
    else:
        logger.info("[analyze] refinement pass disabled (ANALYZE_REFINE not set) — using pass-1 masks")

    # --- Apply refinements + convert to paths ------------------------------
    final_regions: list[CandidateRegion] = []
    for i, (region, current_mask) in enumerate(zip(valid_regions, pass1_masks)):
        refinement = ref_by_idx.get(i)
        if refinement is not None and refinement.action == "drop":
            logger.info("[analyze] region #%d (%r) dropped by refinement", i + 1, region.label)
            continue
        if refinement is not None and refinement.action == "refine" and refinement.refined_prompts:
            refined_mask = _sam_decode_for_prompts(sam, sid, refinement.refined_prompts, w, h)
            final_mask = refined_mask if refined_mask is not None else current_mask
            if refined_mask is not None:
                logger.info(
                    "[analyze] region #%d (%r) refined: bbox=%s +pts=%d -pts=%d",
                    i + 1,
                    region.label,
                    refinement.refined_prompts.bbox,
                    len(refinement.refined_prompts.positive_points),
                    len(refinement.refined_prompts.negative_points),
                )
        else:
            final_mask = current_mask
        paths = _mask_to_paths(final_mask)
        if not paths:
            continue
        region.paths = paths
        region.mask_png_base64 = _mask_to_png_base64(final_mask)
        # Replace Claude's pre-SAM point guess with the actual mask centroid so
        # the AI palette's visual anchor and any downstream SAM re-prompting
        # both sit inside the segmented region.
        centroid = _mask_centroid_normalised(final_mask)
        if centroid is not None:
            region.representative_point = [centroid[0], centroid[1]]
        final_regions.append(region)
    context.candidate_regions = final_regions


@router.post("/analyze", response_model=ImageContext, response_model_by_alias=True)
async def analyze(
    body: AnalyzeRequest,
    store: SessionStore = Depends(deps.get_session_store),
    client: AnthropicClient = Depends(deps.get_anthropic_client),
    sam: SamClient = Depends(deps.get_sam_client),
) -> ImageContext:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")

    if record.context is not None:
        return ImageContext.model_validate(record.context)

    try:
        context = client.analyze_image(
            image_bytes=record.image_bytes,
            mime_type=record.mime_type,
            session_id=body.session_id,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=502, detail=f"image analysis failed: {err}")

    if _presegment_enabled():
        image_rgb = _decode_image_rgb(record.image_bytes)
        _refine_regions(context, image_rgb, sam, client, body.session_id)
    else:
        # New chip workflow: /analyze returns labels + bbox + representative_point
        # only; SAM runs per-click in the frontend. Drop regions without a
        # representative_point (unusable for any downstream selection).
        context.candidate_regions = [
            r for r in context.candidate_regions if r.representative_point is not None
        ]
        logger.info(
            "[analyze] pre-segmentation disabled (ANALYZE_PRESEGMENT not set) — "
            "returning %d labelled regions",
            len(context.candidate_regions),
        )

    store.set_context(body.session_id, context.model_dump(mode="json", by_alias=True))
    return context


# ─── /api/name-region ─────────────────────────────────────────────────


class NameRegionRequest(BaseModel):
    session_id: str
    # 1-channel PNG (0/255) base64-encoded; same format the frontend sends to
    # /api/segment/decode. The endpoint draws this mask's outline on top of the
    # session's cached image to give Claude visual context.
    mask_png_base64: str


def _decode_mask_png_base64(b64: str) -> np.ndarray:
    """Decode a 1-channel base64 PNG mask into a numpy bool array."""
    raw = base64.b64decode(b64)
    pil = Image.open(io.BytesIO(raw))
    # Force 1-channel grayscale.
    if pil.mode != "L":
        pil = pil.convert("L")
    arr = np.array(pil)
    return arr > 127


def _resize_mask_to(mask: np.ndarray, target_h: int, target_w: int) -> np.ndarray:
    """Resize a 0/1 mask to (target_h, target_w) using nearest-neighbour."""
    if mask.shape[0] == target_h and mask.shape[1] == target_w:
        return mask
    mask_u8 = (mask.astype(np.uint8)) * 255 if mask.dtype == bool else mask.astype(np.uint8)
    resized = cv2.resize(mask_u8, (target_w, target_h), interpolation=cv2.INTER_NEAREST)
    return resized > 127


def _render_outlined_region(image_rgb: np.ndarray, mask: np.ndarray) -> bytes:
    """Draw the mask outline in magenta on the original image.
    Returns JPEG bytes suitable for Claude's vision input."""
    out = image_rgb.copy()
    mask_u8 = (mask.astype(np.uint8)) * 255 if mask.dtype == bool else mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    thickness = max(3, int(min(image_rgb.shape[:2]) * 0.006))
    cv2.drawContours(out, contours, -1, (255, 0, 255), thickness)
    pil = Image.fromarray(out)
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _summarise_context(ctx_json: dict | None) -> str:
    """Render a short, plain-text summary of the cached ImageContext so
    Claude can disambiguate similar objects when naming a new region."""
    if not ctx_json:
        return "(no prior context available)"
    subjects = ", ".join(ctx_json.get("subjects") or []) or "(none)"
    lighting = ctx_json.get("lighting") or "?"
    tones = ", ".join(ctx_json.get("dominant_tones") or []) or "(none)"
    mood = ctx_json.get("mood") or "?"
    region_labels = [r.get("label") for r in (ctx_json.get("candidate_regions") or []) if r.get("label")]
    region_str = ", ".join(region_labels) if region_labels else "(none)"
    return (
        f"Subjects: {subjects}\n"
        f"Lighting: {lighting}\n"
        f"Dominant tones: {tones}\n"
        f"Mood: {mood}\n"
        f"Previously named regions in this image: {region_str}"
    )


@router.post("/name-region", response_model=RegionLabel, response_model_by_alias=True)
async def name_region(
    body: NameRegionRequest,
    store: SessionStore = Depends(deps.get_session_store),
    client: AnthropicClient = Depends(deps.get_anthropic_client),
) -> RegionLabel:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")

    image_rgb = _decode_image_rgb(record.image_bytes)
    h, w = image_rgb.shape[:2]
    mask = _decode_mask_png_base64(body.mask_png_base64)
    mask = _resize_mask_to(mask, h, w)
    annotated = _render_outlined_region(image_rgb, mask)
    summary = _summarise_context(record.context)

    try:
        label = client.name_region(
            annotated_image=annotated,
            mime_type="image/jpeg",
            context_summary=summary,
            session_id=body.session_id,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=502, detail=f"region naming failed: {err}")

    return RegionLabel(label=label)
