from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Response, UploadFile

from app.services.raw_decode import RawDecodeError, develop_raw_to_jpeg

router = APIRouter()


@router.post("/raw/develop")
async def raw_develop(image: UploadFile = File(...)) -> Response:
    """Develop an uploaded camera-RAW file into a JPEG preview.

    Sessionless, pure transform: the browser can't decode RAW, so it posts the
    raw bytes here and feeds the returned JPEG into its normal image-open path.
    Uses the embedded preview when present, else a full demosaic. 415 when the
    bytes aren't a readable RAW.
    """
    data = await image.read()
    try:
        jpeg = develop_raw_to_jpeg(data)
    except RawDecodeError as exc:
        raise HTTPException(status_code=415, detail=str(exc))
    return Response(content=jpeg, media_type="image/jpeg")
