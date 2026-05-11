from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import get_settings
from app.services.session_store import SessionStore

from .deps import get_session_store

router = APIRouter()


@router.post("/session")
async def create_session(
    image: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    settings = get_settings()
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="image/* MIME type required")
    data = await image.read()
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="image too large")
    sid = store.create(image_bytes=data, mime_type=image.content_type)
    return {"session_id": sid}
