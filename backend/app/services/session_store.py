from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Lock
from typing import TYPE_CHECKING, Any, Iterator

if TYPE_CHECKING:
    from app.state.document import SessionDocument


class SessionNotFound(KeyError):
    pass


def _new_document(sid: str, record: "SessionRecord") -> "SessionDocument":
    """Lazy-create a SessionDocument from a SessionRecord.

    Imported inside the function to avoid pulling app.state.document into
    the session-store module at definition time — keeps the store a pure
    registry. SessionDocument transitively imports image_context etc.,
    so we defer until actually needed."""
    from app.state.document import SessionDocument
    return SessionDocument(
        session_id=sid,
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
    )


@dataclass
class SessionRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    last_seen: float
    context: dict[str, Any] | None = None
    graphs: dict[str, dict[str, Any]] = field(default_factory=dict)
    document: "SessionDocument | None" = None  # lazily created
    write_lock: Lock = field(default_factory=Lock)


class SessionStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._records: dict[str, SessionRecord] = {}
        self._lock = Lock()

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
        return sid

    def get(self, sid: str) -> SessionRecord:
        with self._lock:
            record = self._records.get(sid)
            if record is None:
                raise SessionNotFound(sid)
            if self._is_expired(record):
                self._records.pop(sid, None)
                raise SessionNotFound(sid)
            record.last_seen = time.monotonic()
            return record

    def touch(self, sid: str) -> None:
        self.get(sid)

    def set_context(self, sid: str, context: dict[str, Any]) -> None:
        record = self.get(sid)
        record.context = context

    def store_graph(self, sid: str, graph_id: str, graph: dict[str, Any]) -> None:
        record = self.get(sid)
        record.graphs[graph_id] = graph

    def get_graph(self, sid: str, graph_id: str) -> dict[str, Any] | None:
        record = self.get(sid)
        return record.graphs.get(graph_id)

    def get_document(self, sid: str) -> "SessionDocument":
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
        return record.document

    @contextmanager
    def with_document_lock(self, sid: str) -> Iterator["SessionDocument"]:
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
        with record.write_lock:
            yield record.document
