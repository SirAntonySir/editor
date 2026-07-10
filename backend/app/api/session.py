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

import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile

from app.schemas.image_context import ImageContext
from app.services import cohort_store, disk_session_io
from app.services.event_journal import write_event
from app.services.image_validation import (
    ImageValidationError,
    reject_oversize_content_length,
    validate_image_upload,
)
from app.services.session_store import SessionNotFound, SessionStore
from app.state.document import DEFAULT_IMAGE_NODE_ID

from .deps import get_session_store

# Anonymous cohort cookie. Set on the first session create; lets the
# admin cockpit group multiple sessions from the same browser as one
# user without storing PII. The value is a random UUID — no link back
# to a real identity.
_COHORT_COOKIE = "editor_uid"
_COHORT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year


def _resolve_user_id(request: Request, response: Response) -> str:
    """Return the existing cohort cookie or mint a fresh one. Sets the
    cookie on `response` so the browser persists it."""
    existing = request.cookies.get(_COHORT_COOKIE)
    if existing:
        return existing
    new_uid = uuid.uuid4().hex
    response.set_cookie(
        _COHORT_COOKIE,
        new_uid,
        max_age=_COHORT_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
    )
    return new_uid

def _parse_content_length(request: Request) -> int | None:
    raw = request.headers.get("content-length")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


router = APIRouter()


@router.post("/session")
async def create_session(
    request: Request,
    response: Response,
    image: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    try:
        reject_oversize_content_length(_parse_content_length(request))
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc
    data = await image.read()
    try:
        validated = validate_image_upload(data, image.content_type)
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc
    # Resolve the cohort (participant) identity BEFORE creating the session so
    # the new session inherits the participant's study condition. Each reload /
    # new image-open mints a fresh session; cohort inheritance is what makes the
    # admin-set AI_access stick across all of them.
    user_id = _resolve_user_id(request, response)
    ai_access = cohort_store.get_cohort_ai_access(user_id)
    sid = store.create(
        image_bytes=validated.image_bytes,
        mime_type=validated.mime_type,
        ai_access=ai_access,
    )
    # Emit a synthetic session.created event so the cockpit can pin a
    # session to its user, browser, and upload bytes-count without
    # snooping inside the persistence layer.
    write_event(sid, "session.created", {
        "user_id": user_id,
        "user_agent": request.headers.get("user-agent", ""),
        "bytes": len(validated.image_bytes),
        "mime_type": validated.mime_type,
        "filename": image.filename or "",
    })
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
    request: Request,
    image: UploadFile = File(...),
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    """Add a second (or Nth) image to an existing session under a freshly
    minted `in-N` image_node_id. The primary single-file disk layout is
    preserved; the new image is persisted next to it keyed by node id so it
    survives a server restart. See Task 4 of the multi-image-canvas plan."""
    try:
        reject_oversize_content_length(_parse_content_length(request))
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc
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


# Genfill result assets. Namespaced ids only — this is NOT a general file
# server; anything outside the genfill-<widget_id> pattern 404s.
_ASSET_ID_RE = re.compile(r"^genfill-[A-Za-z0-9_-]+$")


@router.get("/session/{sid}/assets/{asset_id}")
async def get_session_asset(sid: str, asset_id: str) -> Response:
    """Serve a generated asset (genfill result PNG)."""
    if not _ASSET_ID_RE.fullmatch(asset_id):
        raise HTTPException(status_code=404, detail="unknown asset")
    data = disk_session_io.read_asset(sid, asset_id)
    if data is None:
        raise HTTPException(status_code=404, detail="unknown asset")
    return Response(content=data, media_type="image/png")
