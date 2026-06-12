from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.schemas.widget import StateEvent
from app.services.session_store import SessionNotFound, SessionStore
from app.state.events import EventBus
from app.state.snapshot import SessionStateSnapshot, compute_snapshot

router = APIRouter()


def _encode(ev: StateEvent) -> dict[str, str]:
    """Format a StateEvent for sse_starlette.

    `id` is the revision — the browser remembers it as lastEventId and
    sends it back as `Last-Event-ID` on automatic reconnect. The backend
    uses that to replay any missed events from `doc.history`.

    `data` carries the JSON the frontend parses. Deliberately no `event`
    field — see the long comment below in `state_events` for why.
    """
    return {
        "id": str(ev.revision),
        "data": json.dumps({
            "revision": ev.revision,
            "kind": ev.kind,
            "payload": ev.payload,
            "emitted_at": ev.emitted_at.isoformat(),
        }),
    }


def _parse_last_event_id(raw: str | None) -> int | None:
    """Returns the integer revision, or None if the header is absent /
    malformed. We treat malformed as 'no Last-Event-Id' rather than 4xx —
    a misbehaving client gets a fresh stream, not an error page."""
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _store() -> SessionStore:
    return deps.get_session_store()


def _bus() -> EventBus:
    return deps.get_event_bus()


@router.get("/state/{sid}", response_model=SessionStateSnapshot, response_model_by_alias=True)
async def state_snapshot(sid: str) -> SessionStateSnapshot:
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return compute_snapshot(doc)


def _apply_history_snapshot(sid: str, snap, action: str) -> dict:
    """Shared body for undo/redo/revert: take the write lock, restore
    state, publish events, dirty the checkpointer. `action` becomes the
    `applied` field in the response so the frontend can log which path
    fired. Returns the new revision + applied marker."""
    store = _store()
    bus = _bus()
    with store.with_document_lock(sid) as doc:
        ev = doc.apply_snapshot(snap)
        bus.publish(sid, ev)
        doc._published_idx = len(doc.history)
        from app.config import get_app_config
        doc.prune_history(get_app_config().runtime.history_max_entries)
        doc.gc_dismissed_widgets()
        store.checkpointer.mark_dirty(doc)
    return {"revision": ev.revision, "applied": action}


@router.post("/state/{sid}/undo")
async def state_undo(sid: str) -> dict:
    """Pop one entry off the undo stack and restore its `before` snapshot.
    409 when nothing is undoable (cursor at -1)."""
    try:
        history = _store().get_history(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    snap = history.undo()
    if snap is None:
        raise HTTPException(status_code=409, detail="nothing to undo")
    return _apply_history_snapshot(sid, snap, action="undo")


@router.post("/state/{sid}/redo")
async def state_redo(sid: str) -> dict:
    """Restore the `after` snapshot of the next entry. 409 when already
    at the newest entry."""
    try:
        history = _store().get_history(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    snap = history.redo()
    if snap is None:
        raise HTTPException(status_code=409, detail="nothing to redo")
    return _apply_history_snapshot(sid, snap, action="redo")


@router.post("/state/{sid}/revert")
async def state_revert(sid: str) -> dict:
    """Jump back to the pre-history baseline. Entries survive so the
    user can redo afterwards. 409 when the stack is empty."""
    try:
        history = _store().get_history(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    snap = history.revert_all()
    if snap is None:
        raise HTTPException(status_code=409, detail="nothing to revert")
    return _apply_history_snapshot(sid, snap, action="revert")


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
async def state_events(
    sid: str,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
):
    """SSE stream of StateEvents.

    Supports the EventSource `Last-Event-ID` reconnect protocol: when the
    browser reopens this stream after a disconnect, it sends the last
    `id:` it saw and we replay any events in `doc.history` with a
    higher revision before going live.

    If `Last-Event-ID` points to a revision OLDER than the oldest entry
    in `doc.history` (event log was pruned past it), we emit a synthetic
    `state.gap` event so the frontend knows it must do a full snapshot
    refetch — replay alone can't catch it up.

    Deliberately no `event:` field on the yielded messages: a browser
    EventSource routes named events only to addEventListener("<name>"),
    but the frontend consumes everything via `onmessage` and reads the
    discriminator from `payload.kind`. Emitting `event: <kind>` here
    silently drops every live event on the client.
    """
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    bus = _bus()
    queue = bus.subscribe(sid)
    resume_from = _parse_last_event_id(last_event_id)

    # Capture replay events under the document write_lock so we don't race a
    # mutator that's appending to history. The lock is held only for the
    # snapshot copy; the live loop below doesn't need it (the bus serialises).
    replay: list[StateEvent] = []
    gap_revision: int | None = None
    if resume_from is not None and doc.history:
        oldest = doc.history[0].revision
        newest = doc.history[-1].revision
        if resume_from < oldest - 1:
            # The frontend last saw an event we no longer carry — pure replay
            # would skip everything in (resume_from, oldest). Tell it.
            gap_revision = newest
        elif resume_from < newest:
            replay = [ev for ev in doc.history if ev.revision > resume_from]

    async def gen():
        try:
            if gap_revision is not None:
                yield {
                    "id": str(gap_revision),
                    "data": json.dumps({
                        "revision": gap_revision,
                        "kind": "state.gap",
                        "payload": {"reason": "history_pruned"},
                        "emitted_at": datetime.now(timezone.utc).isoformat(),
                    }),
                }
            for ev in replay:
                yield _encode(ev)
            while True:
                ev = await queue.get()
                yield _encode(ev)
        except asyncio.CancelledError:
            return
        finally:
            bus.unsubscribe(sid, queue)

    return EventSourceResponse(gen())
