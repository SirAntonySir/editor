import base64
import io

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel

from app.schemas.image_context import ImageContext, RegionMask
from app.services.anthropic_client import AnthropicClient
from app.services.sam_client import SamClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


class AnalyzeRequest(BaseModel):
    session_id: str


def _decode_image_rgb(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img)


def _mask_to_png_base64(mask: np.ndarray) -> str:
    if mask.dtype == bool:
        arr = (mask.astype(np.uint8)) * 255
    else:
        arr = mask.astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _refine_regions(context: ImageContext, image_rgb: np.ndarray, sam: SamClient, sid: str) -> None:
    """Populate each region's .mask field by running SAM at its representative_point.
    Mutates context.candidate_regions in place."""
    if not context.candidate_regions:
        return
    sam.embed(sid, image_rgb)
    h, w = image_rgb.shape[:2]
    for region in context.candidate_regions:
        if region.representative_point is None:
            continue
        px, py = region.representative_point
        # Convert from normalised (0–1) to pixel coords if needed.
        if 0.0 <= px <= 1.0 and 0.0 <= py <= 1.0:
            px, py = px * w, py * h
        try:
            mask = sam.decode_point(
                sid,
                points=np.array([[px, py]], dtype=np.float32),
                labels=np.array([1], dtype=np.float32),
            )
        except RuntimeError:
            continue
        if not mask.any():
            continue
        region.mask = RegionMask(
            png_base64=_mask_to_png_base64(mask),
            width=int(mask.shape[1]),
            height=int(mask.shape[0]),
        )


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

    context = client.analyze_image(
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
        session_id=body.session_id,
    )

    image_rgb = _decode_image_rgb(record.image_bytes)
    _refine_regions(context, image_rgb, sam, body.session_id)

    store.set_context(body.session_id, context.model_dump(mode="json"))
    return context
