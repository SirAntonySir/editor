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
                yield {"event": ev.kind, "data": json.dumps({
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
