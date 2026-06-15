from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock

from app.schemas.widget import StateEvent

logger = logging.getLogger(__name__)

# Hard upper bound on per-subscriber in-flight events. A healthy SSE
# consumer drains continuously; reaching this cap means the consumer is
# stuck (slow network, paused tab, dead client) and the queue would
# otherwise grow unbounded. On overflow we drop everything and inject a
# synthetic `state.gap` so the consumer knows to refetch.
_QUEUE_MAXSIZE = 1000


def _gap_event() -> StateEvent:
    """Synthetic event injected when a subscriber's queue overflows.
    Carries revision=-1 (the real revision is unknowable from inside the
    bus); the frontend's gap handler refetches the full snapshot."""
    return StateEvent(
        revision=-1,
        kind="state.gap",
        payload={"reason": "subscriber_overflow"},
        emitted_at=datetime.now(timezone.utc),
    )


class EventBus:
    """In-memory per-session pub/sub. Plan 3 hooks an SSE encoder onto
    `subscribe()`; Plan 1 only needs publish/subscribe for tests and the
    registry's emit step."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[StateEvent]]] = defaultdict(list)
        self._lock = Lock()

    def subscribe(self, session_id: str) -> asyncio.Queue[StateEvent]:
        q: asyncio.Queue[StateEvent] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        with self._lock:
            self._queues[session_id].append(q)
        return q

    def unsubscribe(self, session_id: str, queue: asyncio.Queue[StateEvent]) -> None:
        with self._lock:
            queues = self._queues.get(session_id, [])
            if queue in queues:
                queues.remove(queue)
            if not queues:
                # Drop the empty bucket so long-lived servers don't hold
                # one entry per ever-connected session.
                self._queues.pop(session_id, None)

    def publish(self, session_id: str, event: StateEvent) -> None:
        with self._lock:
            queues = list(self._queues.get(session_id, []))
        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Stuck consumer. Drop everything we still have queued
                # for this subscriber and push a single gap marker — the
                # frontend handles state.gap by refetching the snapshot.
                logger.warning(
                    "EventBus: subscriber overflow for session=%s — dropping %d events, signalling gap",
                    session_id, q.qsize(),
                )
                while not q.empty():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                try:
                    q.put_nowait(_gap_event())
                except asyncio.QueueFull:
                    # Genuinely impossible after the drain above, but be safe.
                    pass
