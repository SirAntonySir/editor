"""HTTP transport for editor sessions.

This module is one of FOUR files that touch ``session`` — each has a
distinct responsibility, none own state on their own:

- ``services/session_store.py`` is the **SSoT** (in-memory + on-disk).
- ``api/session.py`` (this file) is the **HTTP transport** — REST routes
  that the browser frontend hits to upload / cancel / set context.
- ``tools/atomic/create_session.py`` is the equivalent **MCP transport**
  for the create path (base64 instead of multipart).
- ``mcp/session.py`` is unrelated to lifecycle — it maps MCP wire-layer
  session ids to editor session ids for the JSON-RPC pairing layer.

Validation of inbound image bytes is shared with the MCP path via
:func:`app.services.image_validation.validate_image_upload`; both surfaces
must enforce the same MIME + size guards.
"""

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.schemas.image_context import ImageContext
from app.services import disk_session_io
from app.services.image_validation import ImageValidationError, validate_image_upload
from app.services.session_store import SessionNotFound, SessionStore
from app.state.document import DEFAULT_IMAGE_NODE_ID

from .deps import get_session_store

router = APIRouter()


@router.post("/session")
async def create_session(
    image: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    data = await image.read()
    try:
        validated = validate_image_upload(data, image.content_type)
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc
    sid = store.create(image_bytes=validated.image_bytes, mime_type=validated.mime_type)
    return {"session_id": sid}


def _mint_image_node_id(existing_ids: list[str]) -> str:
    """Mint the next `in-N` id given the existing image-node keys on a doc.

    `in-default` occupies the n=0 slot pragmatically: if no `in-N` keys exist,
    the first mint is `in-1`. Otherwise we take `1 + max(int suffix)`. Any
    non-`in-<int>` keys are ignored so unknown id shapes can't poison the
    sequence.
    """
    max_n = 0
    for key in existing_ids:
        if not key.startswith("in-"):
            continue
        suffix = key[len("in-"):]
        try:
            n = int(suffix)
        except ValueError:
            # "in-default" and any other non-numeric suffix don't count.
            continue
        if n > max_n:
            max_n = n
    return f"in-{max_n + 1}"


@router.post("/session/{sid}/images")
async def add_image_to_session(
    sid: str,
    image: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    """Add a second (or Nth) image to an existing session under a freshly
    minted `in-N` image_node_id. The primary single-file disk layout is
    preserved; the new image is persisted next to it keyed by node id so it
    survives a server restart. See Task 4 of the multi-image-canvas plan."""
    data = await image.read()
    try:
        validated = validate_image_upload(data, image.content_type)
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc
    try:
        doc = store.get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    image_node_id = _mint_image_node_id(list(doc.image_bytes_by_node.keys()))
    doc.set_image_bytes(image_node_id, validated.image_bytes, mime_type=validated.mime_type)
    # Persist to disk so the bytes survive a server restart. Keyed by node id,
    # NOT touching the primary `image.<ext>` file.
    disk_session_io.write_image(sid, image_node_id, validated.image_bytes, validated.mime_type)
    return {"image_node_id": image_node_id}


@router.post("/session/{sid}/cancel")
async def cancel_session_task(
    sid: str,
    store: SessionStore = Depends(get_session_store),
) -> dict[str, Any]:
    """Cancel the in-flight mutate/emit tool task for this session, if any.
    Used by the frontend's "Cancel" button in the BackendStatusBar to abort
    a long-running analyze run. Idempotent — returns {cancelled: false} if no
    task is currently running."""
    try:
        store.touch(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    cancelled = store.cancel_task(sid)
    return {"cancelled": cancelled}


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
        store.set_context(sid, body.model_dump(mode="json", by_alias=True))
        # Per-image-node-only doctrine: set_context above persists to disk for
        # legacy callers; the typed model goes on the per-node dict so tools
        # can read it directly via doc.get_image_context(image_node_id).
        doc = store.get_document(sid)
        doc.set_image_context(DEFAULT_IMAGE_NODE_ID, body)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return {"session_id": sid}
