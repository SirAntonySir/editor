from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.schemas.widget import StateEvent
from app.services.session_store import SessionNotFound, SessionStore
from app.state.events import EventBus
from app.state.snapshot import SessionStateSnapshot, compute_snapshot
from app.state.document import DEFAULT_IMAGE_NODE_ID
from app.tools.agent_loop import run_agent_turn, dispatch_propose_adjustment
from app.tools.client_tool_bridge import request_client_tool

logger = logging.getLogger(__name__)

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


def _build_reference_summaries(
    store: SessionStore, sid: str, reference_ids: set[str],
) -> list[dict]:
    """Compact appearance summary per reference image node, computed on demand
    from the cheap pass (no dependency on the reference having been analyzed).
    Best-effort: a node whose bytes can't be decoded is skipped. The summary is
    what the agent uses to move the TARGET toward the reference's look."""
    if not reference_ids:
        return []
    import io

    import numpy as np
    from PIL import Image

    from app.state.context_stats import compute_cheap_pass

    try:
        doc = store.get_document(sid)
    except SessionNotFound:
        return []

    out: list[dict] = []
    for nid in sorted(reference_ids):
        try:
            arr = np.asarray(Image.open(io.BytesIO(doc.get_image_bytes(nid))).convert("RGB"))
            cheap = compute_cheap_pass(arr)
        except Exception:
            logger.warning("reference summary failed for %s", nid, exc_info=True)
            continue
        a, b = cheap.cast_direction
        parts = [
            f"cast a*={a:.0f} b*={b:.0f} (strength {cheap.cast_strength:.2f})",
            f"median_luma {cheap.median_luma:.0f}",
            f"contrast_p10_p90 {cheap.contrast_p10_p90:.0f}",
        ]
        ctx = doc.get_image_context(nid)
        grade = getattr(ctx, "grade_character", None) if ctx is not None else None
        if grade:
            parts.append(f"grade {grade}")
        if cheap.color_palette:
            swatches = ", ".join(
                f"rgb({s.rgb[0]},{s.rgb[1]},{s.rgb[2]})" for s in cheap.color_palette[:3]
            )
            parts.append(f"palette {swatches}")
        out.append({"image_node_id": nid, "summary": "; ".join(parts)})
    return out


class _AgentTurnBody(BaseModel):
    intent: str
    attached_objects: list[str] = []
    forced_targets: list[dict] = []
    reference_targets: list[dict] = []
    client_tools: list[dict] = []
    active_node: dict | None = None


class _ToolResultBody(BaseModel):
    request_id: str
    ok: bool
    output: dict | None = None
    error: str | None = None
    denied: bool = False


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


@router.post("/state/{sid}/tool_result")
async def state_tool_result(sid: str, body: _ToolResultBody) -> dict:
    """Resolve a pending backend→client tool call. The frontend POSTs here
    after running (or denying) an LlmToolRegistry tool requested via a
    client.tool_request event. Returns {resolved: bool} — False when the
    request_id is unknown (already resolved, timed out, or never existed)."""
    store = _store()
    try:
        store.touch(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    resolved = store.resolve_client_request(
        sid,
        body.request_id,
        {"ok": body.ok, "output": body.output, "error": body.error, "denied": body.denied},
    )
    return {"resolved": resolved}


@router.post("/state/{sid}/agent_turn")
async def state_agent_turn(sid: str, body: _AgentTurnBody) -> dict:
    """Run an agentic palette turn — a multi-turn Anthropic tool-use loop. Holds
    NO write-lock: sub-mutations go through registry.invoke (brief locks) and
    client tools through request_client_tool. The active image node's layer ids
    seed node_layers so propose_adjustment_widgets can scope correctly."""
    store = _store()
    bus = _bus()
    try:
        store.touch(sid)  # 404 if the session is unknown; no lock held into the loop.
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    # Seed node_layers from the active node the frontend sent (real layer ids);
    # extracted nodes are threaded in by the loop. Falls back to the default
    # node when none was supplied (e.g. empty canvas).
    if body.active_node and body.active_node.get("image_node_id"):
        node_layers = {body.active_node["image_node_id"]: list(body.active_node.get("layer_ids", []))}
    else:
        node_layers = {DEFAULT_IMAGE_NODE_ID: [DEFAULT_IMAGE_NODE_ID]}

    # Frontend pre-extracted the user's attached region chips into their own
    # image nodes (see runAgentTurn). Seed those so propose_adjustment_widgets
    # resolves their layer ids, and collect their ids so the loop can force the
    # LLM to act on them (not the whole image).
    forced_target_ids: list[str] = []
    for ft in body.forced_targets:
        node_id = ft.get("image_node_id")
        if not node_id:
            continue
        node_layers[node_id] = list(ft.get("layer_ids", []))
        forced_target_ids.append(node_id)

    # Reference nodes: the user wants the target to LOOK LIKE these, but they
    # must NEVER be edited. Kept OUT of node_layers (the target whitelist) so
    # propose can't dispatch on them; each gets a compact appearance summary
    # (mechanical, computed on demand) the loop feeds the model to match.
    reference_ids = {
        rt.get("image_node_id") for rt in body.reference_targets if rt.get("image_node_id")
    } - set(node_layers.keys())  # a node that's also a target stays a target
    references = _build_reference_summaries(store, sid, reference_ids)

    anthropic = deps.get_anthropic_client()
    registry = deps.get_tool_registry()

    # Give the LLM the image context (regions, tones, problems) so it acts
    # instead of replying in prose. Same source propose_stack uses; stripped of
    # mask bytes / histogram bins via image_context_for_llm.
    image_context = None
    try:
        doc = store.get_document(sid)
        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        if ctx is not None:
            from app.services.llm_context import image_context_for_llm
            image_context = image_context_for_llm(ctx.model_dump(mode="json", by_alias=True))
    except Exception:
        image_context = None  # context is a best-effort prompt aid, never fatal

    async def propose_fn(target_image_node_id: str, intent: str) -> dict:
        return await dispatch_propose_adjustment(
            registry, sid, target_image_node_id=target_image_node_id,
            layer_ids=node_layers.get(target_image_node_id, []), intent=intent,
        )

    async def client_tool_fn(name: str, input: dict) -> dict:
        return await request_client_tool(store, bus, sid, name=name, input=input, kind="mutate")

    return await run_agent_turn(
        agent_step=anthropic.agent_message,
        sid=sid, intent=body.intent, attached_objects=body.attached_objects,
        client_tools=body.client_tools, node_layers=node_layers,
        forced_targets=forced_target_ids,
        references=references,
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
        image_context=image_context,
    )


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


@router.get("/state/{sid}/widget-history/{widget_id}")
async def state_widget_history(sid: str, widget_id: str) -> dict:
    """Per-widget history: the slice of the global undo stack that touched
    `widget_id`, with that widget's param snapshots inlined so the client can
    render deltas. `current_entry_id` is the entry that matches the live
    cursor (lets the timeline mark "current" without the global cursor math)."""
    try:
        history = _store().get_history(sid)
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    entries = history.widget_timeline(widget_id)

    # "Current" = the latest timeline entry whose stored after-params match the
    # widget's live params. Robust to restores (which append a new entry but
    # land the widget on an existing entry's state) — so the stepper points at
    # the state the widget is actually in, not the cursor tip.
    w = doc.widgets.get(widget_id)
    live = {n.id: dict(n.params) for n in w.nodes} if w is not None else {}
    current: str | None = None
    for e in entries:
        if e.widget_params_after.get(widget_id, {}) == live:
            current = e.id

    return {
        "entries": [
            {
                "id": e.id,
                "ts": e.ts,
                "label": e.label,
                "params_before": e.widget_params_before.get(widget_id, {}),
                "params_after": e.widget_params_after.get(widget_id, {}),
            }
            for e in entries
        ],
        "current_entry_id": current,
        "can_restore": True,
    }


@router.post("/state/{sid}/restore-widget/{widget_id}/{entry_id}")
async def state_restore_widget(sid: str, widget_id: str, entry_id: str) -> dict:
    """Restore one widget's params from a past history entry, re-applied as a
    NEW forward mutation. The restore lands as a fresh history entry (so it
    shows in the global history and is itself undoable) rather than rewinding
    the whole session. Nodes/params that no longer exist on the live widget
    are skipped defensively."""
    store = _store()
    bus = _bus()
    try:
        history = store.get_history(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    entry = next((e for e in history.entries if e.id == entry_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail="history entry not found")
    target_params = entry.widget_params_after.get(widget_id)
    if target_params is None:
        raise HTTPException(status_code=404, detail=f"widget {widget_id} not in history entry")

    from app.config import get_app_config
    from app.session.history import Snapshot

    async with store.with_document_lock(sid) as doc:
        w = doc.widgets.get(widget_id)
        if w is None:
            raise HTTPException(status_code=404, detail=f"widget {widget_id} not found")
        before = Snapshot.capture(doc)
        for node in w.nodes:
            stored = target_params.get(node.id)
            if not stored:
                continue  # node added/removed since — skip defensively
            for pkey, pval in stored.items():
                node.params[pkey] = pval
                doc.set_param(node.layer_id, node.type, pkey, pval)
            for b in w.bindings:
                if b.target.node_id == node.id and b.param_key in stored:
                    b.value = stored[b.param_key]
        w.revision += 1
        doc.update_widget(w)
        after = Snapshot.capture(doc)
        history.push(
            label=f"Restored {w.intent} to earlier state",
            before=before,
            after=after,
            affected_widget_ids=[widget_id],
            widget_params_before=before.extract_widget_params([widget_id]),
            widget_params_after=after.extract_widget_params([widget_id]),
            is_restore=True,
        )
        # Publish the canonical.updated / widget.updated events emitted above.
        # _event_sink is None outside the registry tool path, so they only
        # appended to doc.history — mirror _flush_history_to_bus here.
        for ev in doc.history[doc._published_idx:]:
            bus.publish(sid, ev)
        doc._published_idx = len(doc.history)
        doc.prune_history(get_app_config().runtime.history_max_entries)
        doc.gc_dismissed_widgets()
        store.checkpointer.mark_dirty(doc)
        revision = doc.revision
    return {"revision": revision, "applied": "restore_widget_params"}


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
