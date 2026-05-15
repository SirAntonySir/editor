from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


class SessionNotFound(KeyError):
    pass


@dataclass
class SessionRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    last_seen: float
    context: dict[str, Any] | None = None
    graphs: dict[str, dict[str, Any]] = field(default_factory=dict)


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
