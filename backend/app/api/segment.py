from __future__ import annotations

import base64
import io
import time
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from app.services.sam_client import SamClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


class EmbedRequest(BaseModel):
    session_id: str


class EmbedResponse(BaseModel):
    ok: bool
    embedded_at: float


class SegmentPrompt(BaseModel):
    kind: Literal["point", "box"]
    data: list[float] = Field(min_length=3, max_length=4)


class DecodeRequest(BaseModel):
    session_id: str
    prompts: list[SegmentPrompt] = Field(min_length=1)


class DecodeResponse(BaseModel):
    mask_png_base64: str
    width: int
    height: int
    model: str


def _decode_image_rgb(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img)


def _mask_to_png_base64(mask: np.ndarray) -> str:
    """Convert a bool/uint8 mask to a single-channel PNG, base64-encoded."""
    if mask.dtype == bool:
        arr = (mask.astype(np.uint8)) * 255
    else:
        arr = mask.astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


@router.post("/segment/embed", response_model=EmbedResponse)
async def embed(
    body: EmbedRequest,
    store: SessionStore = Depends(deps.get_session_store),
    sam: SamClient = Depends(deps.get_sam_client),
) -> EmbedResponse:
    try:
        rec = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    image_rgb = _decode_image_rgb(rec.image_bytes)
    sam.embed(body.session_id, image_rgb)
    return EmbedResponse(ok=True, embedded_at=time.time())


@router.post("/segment/decode", response_model=DecodeResponse)
async def decode(
    body: DecodeRequest,
    sam: SamClient = Depends(deps.get_sam_client),
) -> DecodeResponse:
    points: list[list[float]] = []
    labels: list[float] = []
    box: list[float] | None = None
    for p in body.prompts:
        if p.kind == "point":
            if len(p.data) != 3:
                raise HTTPException(status_code=400, detail=f"point prompt needs [x,y,label], got {p.data!r}")
            points.append([p.data[0], p.data[1]])
            labels.append(p.data[2])
        elif p.kind == "box":
            if len(p.data) != 4:
                raise HTTPException(status_code=400, detail=f"box prompt needs [x1,y1,x2,y2], got {p.data!r}")
            if box is not None:
                raise HTTPException(status_code=400, detail="multiple box prompts not supported")
            box = list(p.data)

    if box is not None and points:
        raise HTTPException(status_code=400, detail="mixing box and point prompts not supported")

    try:
        if box is not None:
            mask = sam.decode_box(body.session_id, np.array(box, dtype=np.float32))
        else:
            mask = sam.decode_point(
                body.session_id,
                points=np.array(points, dtype=np.float32),
                labels=np.array(labels, dtype=np.float32),
            )
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=str(err))

    return DecodeResponse(
        mask_png_base64=_mask_to_png_base64(mask),
        width=mask.shape[1],
        height=mask.shape[0],
        model=f"sam-{sam.model_name}" if hasattr(sam, "model_name") else "sam",
    )
