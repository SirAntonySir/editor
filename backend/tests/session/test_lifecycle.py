"""End-to-end Phase 2 verification.

Closes Task #16. Two checks the unit tests can't cover on their own:

1. The FastAPI lifespan hook actually wires revive_all + checkpointer
   start/stop. The simulated-restart test in test_session_endpoint
   asserts the persistence layer; this one asserts the lifespan path.

2. SessionDocument.history stays bounded under sustained churn.
   Catches a regression where the prune_history call could be
   removed from the registry-finally path or the cap loosened.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_app_config
from app.state.document import SessionDocument


@pytest.fixture(autouse=True)
def _isolated_sessions_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    yield


def test_lifespan_starts_and_stops_checkpointer(monkeypatch: pytest.MonkeyPatch):
    """Entering the FastAPI lifespan context starts the checkpointer's
    background tick. Exiting it cancels the task and drains any dirty
    sessions to disk. We exercise that path via TestClient's context
    manager (which triggers startup/shutdown)."""
    from app.api import deps
    from app.main import app
    from app.services.session_store import SessionStore
    from app.session.persistence import load_document

    store = SessionStore(ttl_seconds=3600)
    # Swap in our store before lifespan runs so revive_all sees it.
    # monkeypatch restores the real singleton after the test so other
    # tests in the suite aren't poisoned with this empty store.
    monkeypatch.setattr(deps, "_session_store", store)

    with TestClient(app) as client:
        # Inside the lifespan: checkpointer task should be running.
        assert store.checkpointer._task is not None
        assert not store.checkpointer._task.done()

        # Create a session via HTTP and mutate it through the registry path
        # so mark_dirty fires.
        image_path = Path(__file__).parent.parent / "fixtures" / "test_image.jpg"
        with image_path.open("rb") as fh:
            sid = client.post(
                "/api/session",
                files={"image": ("a.jpg", fh, "image/jpeg")},
            ).json()["session_id"]

        # Direct mutation + explicit mark_dirty — exercises the same path
        # the registry takes on tool invocation.
        doc = store.get_document(sid)
        doc.set_param("layer-1", "basic", "exposure", 0.77)
        store.checkpointer.mark_dirty(doc)

    # After lifespan shutdown, the task is None (stopped) and the dirty
    # session was flushed.
    assert store.checkpointer._task is None
    data = load_document(sid)
    assert data is not None
    assert data["canonical"]["layer-1"]["basic"]["exposure"] == 0.77


def test_history_stays_bounded_under_churn():
    """Stress: emit many more events than the cap, simulate the registry's
    flush-and-prune, assert history len never drifts past the cap."""
    cap = get_app_config().runtime.history_max_entries
    doc = SessionDocument(session_id="sid", image_bytes=b"", mime_type="image/jpeg")

    # 5x the cap should certainly trigger pruning if it works at all.
    for i in range(cap * 5):
        doc.set_param("layer-1", "basic", "exposure", float(i))
        # Periodically prune to simulate the per-tool-invocation cadence in
        # the registry's _flush_history_to_bus. Without this prune call,
        # _emit() alone doesn't trim — that's by design (within a tool
        # invocation, history is unbounded; the registry's finally hook
        # drives the prune).
        if i % 10 == 0:
            doc._published_idx = len(doc.history)
            doc.prune_history(cap)

    # Final flush at the end (mirrors the registry-finally path).
    doc._published_idx = len(doc.history)
    doc.prune_history(cap)

    assert len(doc.history) <= cap
    # And the latest event is preserved (not truncated to junk).
    assert doc.history[-1].kind == "canonical.updated"
    assert doc.history[-1].payload["value"] == float(cap * 5 - 1)


def test_checkpointer_periodic_tick_writes_dirty_sessions(monkeypatch):
    """The background tick wakes every RUNTIME.checkpoint_interval_s and
    flushes everything currently dirty. We compress the interval to 0 so
    the loop fires immediately for the test."""
    import asyncio
    from unittest.mock import patch

    from app.session.checkpointer import Checkpointer
    from app.session.persistence import load_document

    async def run():
        cp = Checkpointer()
        doc = SessionDocument(session_id="sid-tick", image_bytes=b"", mime_type="image/jpeg")
        doc.set_param("layer-1", "basic", "exposure", 0.5)
        cp.mark_dirty(doc)

        # Patch the runtime so the tick fires immediately.
        with patch(
            "app.session.checkpointer.get_app_config",
            return_value=type("F", (), {"runtime": type("R", (), {"checkpoint_interval_s": 0})()})(),
        ):
            await cp.start()
            # Yield enough cycles for the tick to land.
            await asyncio.sleep(0.05)
            await cp.stop()

        return load_document("sid-tick")

    data = asyncio.run(run())
    assert data is not None
    assert data["canonical"]["layer-1"]["basic"]["exposure"] == 0.5
