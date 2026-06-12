"""Checkpointer — schedules SessionDocument flushes to disk.

Two write modes:

  mark_dirty(doc)
    Record dirtiness. The next background tick (every
    RUNTIME.checkpoint_interval_s) flushes any dirty session. Cheap; the
    common case for tool invocations.

  flush_now(doc)
    Synchronous immediate write. Use after a tool that the operator
    really shouldn't lose if the process dies in the next 5 seconds.
    Today no tool calls this directly — registry uses mark_dirty for
    every invocation — but the API is here for future user-action paths
    that want stronger durability than the checkpoint interval.

Lifecycle:
  start() spawns the background asyncio task.
  stop() cancels it AND performs a final flush_all() so a graceful
  shutdown doesn't lose state.

A single instance per process is fine — disk I/O is fast (<1 ms for a
typical doc) and we serialise per-session writes through the document
write_lock that the registry already holds during a mutation.
"""

from __future__ import annotations

import asyncio
import logging
from threading import Lock
from typing import TYPE_CHECKING

from app.config import get_app_config
from app.session import persistence

if TYPE_CHECKING:
    from app.state.document import SessionDocument

logger = logging.getLogger(__name__)


class Checkpointer:
    def __init__(self) -> None:
        # sid -> doc. We hold a reference to the live document so the background
        # task can re-serialise without going through the SessionStore.
        self._dirty: dict[str, "SessionDocument"] = {}
        # Protects _dirty against concurrent mark_dirty / flush_all access.
        # Threading lock (not asyncio) because mark_dirty is called from
        # synchronous tool-registry context.
        self._lock = Lock()
        self._task: asyncio.Task[None] | None = None

    # ---------------- dirty tracking ----------------

    def mark_dirty(self, doc: "SessionDocument") -> None:
        with self._lock:
            self._dirty[doc.session_id] = doc

    def flush_now(self, doc: "SessionDocument") -> None:
        """Synchronous immediate write. Removes the doc from the dirty set."""
        persistence.dump_document(doc, doc.session_id)
        with self._lock:
            self._dirty.pop(doc.session_id, None)

    def flush_all(self) -> int:
        """Flush every dirty session. Returns the count written. Errors per
        session are logged but don't abort the rest — losing one checkpoint
        is recoverable; failing a whole tick is not."""
        with self._lock:
            pending = list(self._dirty.items())
            self._dirty.clear()
        written = 0
        for sid, doc in pending:
            try:
                persistence.dump_document(doc, sid)
                written += 1
            except Exception:
                logger.exception("checkpointer: dump_document failed for sid=%s", sid)
        return written

    # ---------------- lifecycle ----------------

    async def start(self) -> None:
        """Launch the periodic background tick. Idempotent."""
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._tick_loop(), name="checkpointer")

    async def stop(self) -> None:
        """Cancel the tick + drain remaining dirty sessions. Idempotent."""
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.flush_all()

    async def _tick_loop(self) -> None:
        interval = get_app_config().runtime.checkpoint_interval_s
        while True:
            await asyncio.sleep(interval)
            self.flush_all()
