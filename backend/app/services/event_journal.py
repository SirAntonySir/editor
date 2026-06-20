"""Append-only per-session event journal — the foundation for the admin
cockpit's evaluation views.

Every SSE event the EventBus publishes is mirrored to
``.sessions/{sid}/events.jsonl`` (one JSON object per line). The
cockpit aggregates from these files; cost / acceptance-rate / tool-use
metrics are derived, not stored separately.

Synthetic events (entries that never round-trip through the event bus
— image upload, prompt-entered, frontend telemetry) are appended via
``write_event(sid, kind, payload)`` from whichever surface produces
them.

Design notes:

- **Append-only.** A failed write logs and drops the entry; we never
  raise into the bus or the request handler. The cockpit is a research
  tool — we never want it to break the editor.
- **One file per session.** Reading is rare (admin query); appending is
  hot (every event). Per-session files keep each write bounded and let
  prune_disk reclaim space alongside meta.json.
- **JSON Lines, not JSON.** Streaming-friendly; tail -f works during a
  live user study; the admin reader doesn't have to hold the whole log
  in memory.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from app.services import disk_session_io

logger = logging.getLogger(__name__)

# Coarse per-process lock. Journal writes are tiny (~200 B), so the lock
# is held for microseconds; this is cheaper than per-session locks given
# how many sessions can be open concurrently in a study run.
_write_lock = Lock()


def _journal_path(sid: str) -> Path:
    return disk_session_io.SESSIONS_DIR / sid / "events.jsonl"


def write_event(sid: str, kind: str, payload: dict[str, Any] | None = None) -> None:
    """Append one event to the session journal.

    `kind` follows the same dotted vocabulary the SSE bus uses
    (``widget.created``, ``phase.completed``, …) plus the cockpit's own
    synthetic kinds (``session.created``, ``prompt.entered``,
    ``telemetry.<name>``).

    Never raises — a failed write is logged and dropped so an admin
    side-effect can't break the editor.
    """
    try:
        path = _journal_path(sid)
        # Parent dir may not exist on the first event of a session that
        # bypassed save_session (shouldn't happen in production, but is
        # defensive against test orderings).
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": time.time(),
            "iso": datetime.now(timezone.utc).isoformat(),
            "kind": kind,
            "payload": payload or {},
        }
        line = json.dumps(entry, separators=(",", ":")) + "\n"
        with _write_lock:
            with path.open("a", encoding="utf-8") as fp:
                fp.write(line)
    except Exception:  # noqa: BLE001
        logger.exception("event_journal: failed to write %s for sid=%s", kind, sid)


def read_events(sid: str, limit: int | None = None) -> list[dict[str, Any]]:
    """Read all events for a session, newest-first if `limit` is set."""
    path = _journal_path(sid)
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        logger.exception("event_journal: failed to read sid=%s", sid)
        return []
    if limit is not None and len(out) > limit:
        out = out[-limit:]
    return out
