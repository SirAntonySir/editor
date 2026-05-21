from __future__ import annotations

import asyncio
from collections import defaultdict
from threading import Lock

from app.schemas.widget import StateEvent


class EventBus:
    """In-memory per-session pub/sub. Plan 3 hooks an SSE encoder onto
    `subscribe()`; Plan 1 only needs publish/subscribe for tests and the
    registry's emit step."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[StateEvent]]] = defaultdict(list)
        self._lock = Lock()

    def subscribe(self, session_id: str) -> asyncio.Queue[StateEvent]:
        q: asyncio.Queue[StateEvent] = asyncio.Queue()
        with self._lock:
            self._queues[session_id].append(q)
        return q

    def unsubscribe(self, session_id: str, queue: asyncio.Queue[StateEvent]) -> None:
        with self._lock:
            if queue in self._queues.get(session_id, []):
                self._queues[session_id].remove(queue)

    def publish(self, session_id: str, event: StateEvent) -> None:
        with self._lock:
            queues = list(self._queues.get(session_id, []))
        for q in queues:
            q.put_nowait(event)
