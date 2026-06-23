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
    """Compute a snapshot under the per-session write lock so a mutating
    tool can't be mid-write while we read. `compute_snapshot` is a pure
    function over the document — narrow lock scope, released before the
    wire serialisation runs in the response renderer."""
    try:
        async with _store().with_document_lock(sid) as doc:
            # ai_access lives on the SessionRecord (mirrors meta.json), not the
            # document — read it while holding the lock so it can't race a flip.
            ai_access = _store().get(sid).ai_access
            return compute_snapshot(doc, ai_access=ai_access)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")


async def _apply_history_snapshot(sid: str, snap, action: str) -> dict:
    """Shared body for undo/redo/revert: take the write lock, restore
    state, publish events, dirty the checkpointer. `action` becomes the
    `applied` field in the response so the frontend can log which path
    fired. Returns the new revision + applied marker."""
    store = _store()
    bus = _bus()
    async with store.with_document_lock(sid) as doc:
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
    return await _apply_history_snapshot(sid, snap, action="undo")


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
    return await _apply_history_snapshot(sid, snap, action="redo")


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
    return await _apply_history_snapshot(sid, snap, action="revert")


@router.get("/state/{sid}/history")
async def state_history(sid: str) -> dict:
    """Return the session's history log (read-only). Snapshots are omitted
    — the entries carry only id, ts, and label so the client can render a
    list without paying for snapshot bytes on every fetch."""
    try:
        history = _store().get_history(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return {
        "entries": [
            {"id": e.id, "ts": e.ts, "label": e.label}
            for e in history.entries
        ],
        "cursor": history.cursor,
        "can_undo": history.can_undo,
        "can_redo": history.can_redo,
    }


@router.post("/state/{sid}/jump/{target_cursor}")
async def state_jump(sid: str, target_cursor: int) -> dict:
    """Seek the history cursor to `target_cursor`. -1 = pre-history baseline.
    409 when target is invalid or already current."""
    try:
        history = _store().get_history(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    snap = history.jump_to(target_cursor)
    if snap is None:
        raise HTTPException(status_code=409, detail="invalid or no-op jump target")
    return await _apply_history_snapshot(sid, snap, action=f"jump:{target_cursor}")


@router.get("/state/{sid}/masks/{mask_id}")
async def get_mask_bytes(sid: str, mask_id: str) -> dict:
    """Return the full MaskRecord for a single mask, including png_b64 bytes.

    Used by the frontend to rehydrate mask pixel data for masks whose
    mask.created SSE event was dropped during the connection handshake window.

    Read under the per-session write lock so a precompute_regions tool
    mid-mutation can't leave us observing a torn `doc.masks` dict.
    """
    try:
        async with _store().with_document_lock(sid) as doc:
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
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="session not found")


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
    bus = _bus()
    resume_from = _parse_last_event_id(last_event_id)

    # Subscribe + capture replay under the document write_lock so the
    # transition is atomic with respect to any mutating tool. Tools hold
    # the same lock for the entire publish + prune sequence (see
    # tools/registry.py), so while we're under the lock no event can land
    # twice (post-subscribe live AND in our replay slice) and no event
    # can land in neither (between our history read and our subscribe).
    replay: list[StateEvent] = []
    gap_revision: int | None = None
    try:
        async with _store().with_document_lock(sid) as doc:
            queue = bus.subscribe(sid)
            if resume_from is not None and doc.history:
                oldest = doc.history[0].revision
                newest = doc.history[-1].revision
                if resume_from < oldest - 1:
                    # The frontend last saw an event we no longer carry —
                    # pure replay would skip everything in (resume_from,
                    # oldest). Tell it.
                    gap_revision = newest
                elif resume_from < newest:
                    replay = [ev for ev in doc.history if ev.revision > resume_from]
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")

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

    resp = EventSourceResponse(gen())
    # Defeat intermediary response buffering that otherwise holds back
    # incremental SSE events (the symptom: initial snapshot loads via fetch but
    # live widget.created/updated events never arrive through a tunnel/CDN).
    # sse_starlette already sets X-Accel-Buffering: no (nginx); `no-transform`
    # is the directive Cloudflare honors to stop it buffering/compressing the
    # stream.
    resp.headers["Cache-Control"] = "no-cache, no-transform"
    resp.headers["X-Accel-Buffering"] = "no"
    return resp
