from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Iterator

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
    """
    return SessionDocument(
        session_id=sid,
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
    )


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
    document: "SessionDocument | None" = None  # lazily created
    history_engine: "Any" = None  # lazily created HistoryEngine
    write_lock: Lock = field(default_factory=Lock)


class SessionStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._records: dict[str, SessionRecord] = {}
        self._lock = Lock()
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

    def create(self, image_bytes: bytes, mime_type: str) -> str:
        sid = uuid.uuid4().hex
        now = time.monotonic()
        with self._lock:
            self._records[sid] = SessionRecord(
                image_bytes=image_bytes,
                mime_type=mime_type,
                created_at=now,
                last_seen=now,
            )
        # Persist immediately so the session survives a restart even before
        # any analyze runs.
        disk_session_io.save_session(sid, image_bytes, mime_type, created_at=now)
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

    @contextmanager
    def with_document_lock(self, sid: str) -> Iterator["SessionDocument"]:
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
            _rehydrate_document_context(record)
        with record.write_lock:
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

    def prune_disk(self, max_age_seconds: float) -> int:
        """Delete on-disk session directories whose `created_at` is older than
        `max_age_seconds` (compared against current wall-clock time). Returns
        the number of sessions pruned. Caller decides when to invoke.

        Does NOT touch in-memory records — those have their own TTL eviction
        inside `get()`. Use this for periodic background cleanup of stale disk
        state (e.g. after the user closes a project).
        """
        if not disk_session_io.SESSIONS_DIR.exists():
            return 0
        count = 0
        now = time.time()
        for entry in disk_session_io.SESSIONS_DIR.iterdir():
            if not entry.is_dir():
                continue
            meta = entry / "meta.json"
            if not meta.exists():
                continue
            try:
                created = float(json.loads(meta.read_text()).get("created_at", 0))
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue
            if (now - created) > max_age_seconds:
                disk_session_io.delete_session(entry.name)
                count += 1
        return count
