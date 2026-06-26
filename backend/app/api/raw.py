from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Response, UploadFile

from app.services.raw_decode import (
    RawDecodeError,
    develop_raw_to_jpeg,
    develop_raw_to_png16,
)

router = APIRouter()


@router.post("/raw/develop")
async def raw_develop(image: UploadFile = File(...), depth: int = 8) -> Response:
    """Develop an uploaded camera-RAW file into a viewable image.

    Sessionless, pure transform: the browser can't decode RAW, so it posts the
    raw bytes here and feeds the result into its normal image-open path.

    - `depth=8` (default): 8-bit JPEG (embedded preview when full-size, else
      demosaic). Fast; what the 8-bit edit path consumes.
    - `depth=16`: 16-bit sRGB PNG (always demosaiced) for the high-bit-depth
      pipeline. Larger + slower.

    415 when the bytes aren't a readable RAW.
    """
    data = await image.read()
    try:
        if depth == 16:
            return Response(content=develop_raw_to_png16(data), media_type="image/png")
        return Response(content=develop_raw_to_jpeg(data), media_type="image/jpeg")
    except RawDecodeError as exc:
        raise HTTPException(status_code=415, detail=str(exc))
