from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.services.session_store import SessionNotFound, SessionStore
from app.state.events import EventBus
from app.state.snapshot import SessionStateSnapshot, compute_snapshot

router = APIRouter()


def _store() -> SessionStore:
    return deps.get_session_store()


def _bus() -> EventBus:
    return deps.get_event_bus()


@router.get("/state/{sid}", response_model=SessionStateSnapshot)
async def state_snapshot(sid: str) -> SessionStateSnapshot:
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return compute_snapshot(doc)


@router.get("/state/{sid}/masks/{mask_id}")
async def get_mask_bytes(sid: str, mask_id: str) -> dict:
    """Return the full MaskRecord for a single mask, including png_b64 bytes.

    Used by the frontend to rehydrate mask pixel data for masks whose
    mask.created SSE event was dropped during the connection handshake window.
    """
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="session not found")
    mask = doc.masks.get(mask_id)
    if not mask:
        raise HTTPException(status_code=404, detail="mask not found")
    return {
        "id": mask.id,
        "label": mask.label,
        "source": mask.source,
        "width": mask.width,
        "height": mask.height,
        "png_b64": mask.png_b64,
    }


@router.get("/state/{sid}/events")
async def state_events(sid: str):
    try:
        _store().get(sid)  # validate the session exists
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    bus = _bus()
    queue = bus.subscribe(sid)

    async def gen():
        try:
            while True:
                ev = await queue.get()
                # Deliberately unnamed (no "event" field): a browser EventSource
                # routes named events only to addEventListener("<name>"), but the
                # frontend consumes everything via onmessage and reads the
                # discriminator from payload.kind. Emitting event:<kind> here
                # silently drops every live event on the client.
                yield {"data": json.dumps({
                    "revision": ev.revision,
                    "kind": ev.kind,
                    "payload": ev.payload,
                    "emitted_at": ev.emitted_at.isoformat(),
                })}
        except asyncio.CancelledError:
            return
        finally:
            bus.unsubscribe(sid, queue)

    return EventSourceResponse(gen())
