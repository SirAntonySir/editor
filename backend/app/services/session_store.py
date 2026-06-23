"""SSoT for editor-session state.

This is the single source of truth for session lifecycle, document handle,
per-session write lock, history engine, on-disk persistence, and the
cancellable-in-flight-task slot. All transport surfaces converge here:

- ``api/session.py`` — REST ``POST /api/session`` (multipart upload).
- ``tools/atomic/create_session.py`` — MCP ``create_session`` tool.
- ``mcp/session.py`` — wire-layer pairing registry (separate concern;
  it indexes editor session ids, it doesn't own them).

If you need session state, you go through ``SessionStore``. If you're
adding a third transport, route it through ``store.create`` after
sharing the validation in ``services/image_validation.py`` so the new
surface gets the same 413/415 + bytes-cap enforcement the others have.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock as ThreadLock
from typing import Any, AsyncIterator

from app.schemas.enriched_context import EnrichedImageContext
from app.services import disk_session_io
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


class SessionNotFound(KeyError):
    pass


def _new_document(sid: str, record: "SessionRecord") -> "SessionDocument":
    """Lazy-create a SessionDocument from a SessionRecord. Called by
    SessionStore.get_document on first access for a session that has
    no document yet (e.g. a freshly-uploaded image before its first
    tool invocation).

    Per-image-node-only doctrine: the primary upload bytes go into
    image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] directly. The legacy
    singleton fields are left empty so fresh in-memory sessions match
    the post-revive shape.
    """
    doc = SessionDocument(session_id=sid)
    doc.set_image_bytes(
        DEFAULT_IMAGE_NODE_ID, record.image_bytes, mime_type=record.mime_type,
    )
    return doc


def _rehydrate_document_context(record: "SessionRecord") -> None:
    """If the record carries a cached context dict, parse it into an
    EnrichedImageContext and attach it to the freshly-created document.

    Called once per document lifetime (right after _new_document). On
    parse failure the document's per-node entry is left absent so the
    next analyze run repopulates it cleanly. Per-node-only doctrine:
    we do NOT touch the legacy `image_context` singleton."""
    if record.document is None or record.context is None:
        return
    try:
        parsed = EnrichedImageContext.model_validate(record.context)
        record.document.set_image_context(DEFAULT_IMAGE_NODE_ID, parsed)
    except Exception:
        # Corrupt cache → leave the per-node entry absent.
        record.document.image_context_by_node.pop(DEFAULT_IMAGE_NODE_ID, None)


@dataclass
class SessionRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    last_seen: float
    context: dict[str, Any] | None = None
    # Study-design session constant — see DiskRecord.ai_access. Mirrors the
    # on-disk meta.json flag; surfaced to the frontend via compute_snapshot.
    ai_access: bool = True
    document: "SessionDocument | None" = None  # lazily created
    history_engine: "Any" = None  # lazily created HistoryEngine
    # Per-session document write lock. asyncio.Lock (not threading.Lock):
    # all real production callers are FastAPI async handlers, so a sync
    # lock acquired from the event-loop thread would block the loop on
    # contention — freezing every other session for the duration of any
    # slow Anthropic / SAM call held by the lock owner. asyncio.Lock
    # queues contenders cooperatively.
    write_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class SessionStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._records: dict[str, SessionRecord] = {}
        # Bookkeeping lock — a tiny critical section guarding the records
        # map + in-flight task map. Cheap, never held across awaits, so a
        # threading lock is fine (and lets prune_memory / prune_disk run
        # from sync executor threads without touching the event loop).
        self._lock = ThreadLock()
        # In-flight asyncio.Task per session — set by the tool registry while a
        # mutate/emit tool is running so POST /sessions/{sid}/cancel can call
        # task.cancel(). One slot is enough because the registry serialises
        # mutate calls behind the per-session write_lock.
        self._active_tasks: dict[str, asyncio.Task] = {}
        # Owned by the store so the registry, lifespan hooks, and tests share
        # one checkpointer instance. Imported lazily — Checkpointer pulls in
        # app.session, which imports app.config, which we don't want at the
        # session_store module-import edge.
        from app.session.checkpointer import Checkpointer
        self.checkpointer = Checkpointer()

    def _is_expired(self, record: SessionRecord) -> bool:
        return (time.monotonic() - record.last_seen) > self._ttl

    def create(self, image_bytes: bytes, mime_type: str, ai_access: bool = True) -> str:
        sid = uuid.uuid4().hex
        now = time.monotonic()
        with self._lock:
            self._records[sid] = SessionRecord(
                image_bytes=image_bytes,
                mime_type=mime_type,
                created_at=now,
                last_seen=now,
                ai_access=ai_access,
            )
        # Persist immediately so the session survives a restart even before
        # any analyze runs. ai_access is stamped from the caller's cohort
        # default (see api/session.py) so the study condition is inherited.
        disk_session_io.save_session(sid, image_bytes, mime_type, created_at=now, ai_access=ai_access)
        return sid

    def get(self, sid: str) -> SessionRecord:
        with self._lock:
            record = self._records.get(sid)
            if record is None or self._is_expired(record):
                # Try to rehydrate from disk before raising.
                disk = disk_session_io.load_session(sid)
                if disk is None:
                    self._records.pop(sid, None)
                    raise SessionNotFound(sid)
                now = time.monotonic()
                record = SessionRecord(
                    image_bytes=disk.image_bytes,
                    mime_type=disk.mime_type,
                    created_at=now,
                    last_seen=now,
                    context=disk.context_json,
                    ai_access=disk.ai_access,
                )
                self._records[sid] = record
            record.last_seen = time.monotonic()
            return record

    def touch(self, sid: str) -> None:
        self.get(sid)

    def set_context(self, sid: str, context: dict[str, Any]) -> None:
        record = self.get(sid)
        record.context = context
        disk_session_io.save_context(sid, context)

    def set_ai_access(self, sid: str, ai_access: bool) -> None:
        """Set the study-design AI_access flag on a session (in-memory record +
        on-disk meta.json). Raises SessionNotFound via get() if the session is
        gone. The admin cockpit calls this; the value reaches the frontend on
        the next snapshot fetch (and live via the session.ai_access event)."""
        record = self.get(sid)
        record.ai_access = ai_access
        disk_session_io.save_ai_access(sid, ai_access)

    def get_document(self, sid: str) -> "SessionDocument":
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
            _rehydrate_document_context(record)
        return record.document

    def get_history(self, sid: str) -> "Any":
        """Return the per-session HistoryEngine, lazy-creating it on first
        access. Imported here (not at module top) to avoid pulling
        app.session into the session_store import edge."""
        record = self.get(sid)
        if record.history_engine is None:
            from app.config import get_app_config
            from app.session.history import HistoryEngine
            record.history_engine = HistoryEngine(
                max_entries=get_app_config().runtime.undo_max_entries,
            )
        return record.history_engine

    @asynccontextmanager
    async def with_document_lock(self, sid: str) -> AsyncIterator["SessionDocument"]:
        """Hold the per-session write lock around a document mutation.

        Async on purpose — see SessionRecord.write_lock for the
        rationale. Use as ``async with store.with_document_lock(sid) as
        doc:``. Contention queues cooperatively on the event loop
        instead of blocking it.
        """
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
            _rehydrate_document_context(record)
        async with record.write_lock:
            yield record.document

    # ---------------- cancellable in-flight tasks ----------------

    def register_task(self, sid: str, task: asyncio.Task | None) -> None:
        """Register the asyncio.Task currently running a mutate/emit tool so
        cancel_task() can interrupt it. Safe to call with None (no-op).
        Overwrites any previous registration — the per-session write_lock
        guarantees at most one such task is live."""
        if task is None:
            return
        with self._lock:
            self._active_tasks[sid] = task

    def clear_task(self, sid: str) -> None:
        with self._lock:
            self._active_tasks.pop(sid, None)

    def cancel_task(self, sid: str) -> bool:
        """Cancel the in-flight tool task for this session, if any.
        Returns True when a task was cancelled, False otherwise.

        Note: a synchronous Anthropic SDK call (which is what dominates analyze
        runtime) is NOT preemptible; cancellation lands at the next await,
        typically the next inter-phase asyncio.gather/sleep."""
        with self._lock:
            task = self._active_tasks.get(sid)
        if task is None or task.done():
            return False
        task.cancel()
        return True

    def prune_memory(self, max_age_seconds: float) -> int:
        """Drop in-memory session records whose `last_seen` is older than
        `max_age_seconds` (monotonic-clock comparison). Returns the
        number of records evicted.

        Eviction in `get()` is lazy — a session that's never re-fetched
        keeps its source image bytes in the records map indefinitely.
        Call this from a background sweep to bound RAM."""
        now = time.monotonic()
        with self._lock:
            stale = [
                sid
                for sid, rec in self._records.items()
                if (now - rec.last_seen) > max_age_seconds
            ]
            for sid in stale:
                self._records.pop(sid, None)
                self._active_tasks.pop(sid, None)
        return len(stale)

    def prune_disk(self, max_age_seconds: float) -> int:
        """Delete on-disk session directories whose *last activity* is older
        than `max_age_seconds` (wall-clock). Returns the number of sessions
        pruned. Caller decides when to invoke.

        "Last activity" is the newest mtime among the session's mutating
        files (`events.jsonl` — append on every state event; `state.json` —
        the snapshot checkpoint). Falls back to `meta.json` (a proxy for
        `created_at`) when neither exists. This mirrors `prune_memory`'s
        last-touch semantic so the in-memory and on-disk TTLs agree: a
        long-running session that's still being edited never gets its
        files wiped out from under it.

        Does NOT touch in-memory records — those have their own TTL eviction
        inside `get()` and via `prune_memory`. Use this for periodic
        background cleanup of stale disk state (e.g. after the user closes
        a project and walks away).
        """
        if not disk_session_io.SESSIONS_DIR.exists():
            return 0
        count = 0
        now = time.time()
        for entry in disk_session_io.SESSIONS_DIR.iterdir():
            if not entry.is_dir():
                continue
            last_activity = _last_activity_mtime(entry)
            if last_activity is None:
                continue
            if (now - last_activity) > max_age_seconds:
                disk_session_io.delete_session(entry.name)
                count += 1
        return count


def _last_activity_mtime(session_dir: Path) -> float | None:
    """Return the newest mtime among the session's mutating files, or None
    if none of them exist (in which case the directory is treated as
    incomplete and skipped by the pruner)."""
    candidates = ("events.jsonl", "state.json", "meta.json")
    newest: float | None = None
    for name in candidates:
        p = session_dir / name
        try:
            ts = p.stat().st_mtime
        except OSError:
            continue
        if newest is None or ts > newest:
            newest = ts
    return newest
