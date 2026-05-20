import io
import logging

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel

from app.schemas.image_context import (
    CandidateRegion,
    ImageContext,
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


class AnalyzeRequest(BaseModel):
    session_id: str


def _decode_image_rgb(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img)


def _mask_to_paths(mask: np.ndarray) -> list[list[list[float]]]:
    """Convert a boolean SAM mask into a list of normalised-coordinate polygons.

    Uses cv2.findContours (external contours only, no holes) followed by
    Douglas-Peucker simplification. Coordinates are normalised to 0–1 against
    the mask's own dimensions so the frontend can rescale to any preview size.
    Polygons smaller than `_MIN_CONTOUR_AREA` pixels are dropped.
    """
    h, w = mask.shape[:2]
    mask_u8 = (mask.astype(np.uint8)) * 255 if mask.dtype == bool else mask.astype(np.uint8)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    epsilon = max(1.0, _POLY_EPSILON_FRAC * max(w, h))
    paths: list[list[list[float]]] = []
    for c in contours:
        if cv2.contourArea(c) < _MIN_CONTOUR_AREA:
            continue
        simplified = cv2.approxPolyDP(c, epsilon, closed=True)
        if len(simplified) < 3:
            continue
        poly = [[float(p[0][0]) / w, float(p[0][1]) / h] for p in simplified]
        paths.append(poly)
    return paths


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
        ref_by_idx = {}

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
        final_regions.append(region)
    context.candidate_regions = final_regions


@router.post("/analyze", response_model=ImageContext)
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

    image_rgb = _decode_image_rgb(record.image_bytes)
    _refine_regions(context, image_rgb, sam, client, body.session_id)

    store.set_context(body.session_id, context.model_dump(mode="json"))
    return context
