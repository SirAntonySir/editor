from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import get_settings
from app.schemas.image_context import ImageContext
from app.services.session_store import SessionNotFound, SessionStore

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


@router.post("/session/{sid}/context")
async def set_session_context(
    sid: str,
    body: ImageContext,
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    """
    Bind a pre-computed ImageContext to an existing session — no Claude call.
    Used after page-reload when the client has the cached context locally and
    just needs the backend to know about it (so /api/panel + /api/refine work).
    """
    try:
        store.set_context(sid, body.model_dump(mode="json"))
        # Also write the typed model onto the document so tools can read it directly.
        doc = store.get_document(sid)
        doc.image_context = body
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return {"session_id": sid}
