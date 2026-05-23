from __future__ import annotations

import time
from dataclasses import dataclass, field
from threading import Lock


@dataclass
class _Bucket:
    tokens: float
    last_refill: float = field(default_factory=time.monotonic)


class RateLimiter:
    """Per-session token-bucket rate limiter for MCP tool calls.

    Default capacity equals ``rate_per_minute``; a fresh bucket starts full so
    the first call is never blocked by an unseeded counter. Each call refills
    based on monotonic time elapsed since the last call, capped at capacity.
    """

    def __init__(self, rate_per_minute: int, capacity: int | None = None) -> None:
        self._refill_per_sec = rate_per_minute / 60.0
        self._capacity = float(capacity if capacity is not None else rate_per_minute)
        self._buckets: dict[str, _Bucket] = {}
        self._lock = Lock()

    def try_consume(self, session_id: str, n: float = 1.0) -> bool:
        with self._lock:
            now = time.monotonic()
            bucket = self._buckets.get(session_id)
            if bucket is None:
                bucket = _Bucket(tokens=self._capacity, last_refill=now)
                self._buckets[session_id] = bucket
            else:
                elapsed = now - bucket.last_refill
                bucket.tokens = min(
                    self._capacity,
                    bucket.tokens + elapsed * self._refill_per_sec,
                )
                bucket.last_refill = now
            if bucket.tokens >= n:
                bucket.tokens -= n
                return True
            return False
