"""Checkpointer — mark/flush semantics, error isolation, lifecycle."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.session.checkpointer import Checkpointer
from app.session.persistence import SCHEMA_VERSION, load_document
from app.state.document import SessionDocument


@pytest.fixture(autouse=True)
def _isolated_sessions_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    yield


def _make_doc(sid: str = "sid-test", exposure: float = 0.5) -> SessionDocument:
    doc = SessionDocument(session_id=sid, image_bytes=b"", mime_type="image/jpeg")
    doc.set_param("layer-1", "basic", "exposure", exposure)
    return doc


def test_flush_now_writes_document_to_disk(tmp_path: Path):
    cp = Checkpointer()
    cp.flush_now(_make_doc())
    data = load_document("sid-test")
    assert data is not None
    assert data["canonical"]["layer-1"]["basic"]["exposure"] == 0.5


def test_flush_now_removes_session_from_dirty():
    cp = Checkpointer()
    doc = _make_doc()
    cp.mark_dirty(doc)
    assert "sid-test" in cp._dirty
    cp.flush_now(doc)
    assert "sid-test" not in cp._dirty


def test_mark_dirty_then_flush_all_writes_each_session():
    cp = Checkpointer()
    cp.mark_dirty(_make_doc("sid-a", 0.1))
    cp.mark_dirty(_make_doc("sid-b", 0.2))

    written = cp.flush_all()
    assert written == 2

    a = load_document("sid-a")
    b = load_document("sid-b")
    assert a and a["canonical"]["layer-1"]["basic"]["exposure"] == 0.1
    assert b and b["canonical"]["layer-1"]["basic"]["exposure"] == 0.2


def test_flush_all_clears_dirty_even_on_partial_failure(tmp_path: Path):
    cp = Checkpointer()
    cp.mark_dirty(_make_doc("sid-ok"))
    cp.mark_dirty(_make_doc("sid-fail"))

    # Make the second dump raise — error should be logged, loop should continue.
    real_dump = __import__("app.session.persistence", fromlist=["dump_document"]).dump_document

    def flaky_dump(doc, sid):
        if sid == "sid-fail":
            raise OSError("disk full")
        return real_dump(doc, sid)

    with patch("app.session.checkpointer.persistence.dump_document", side_effect=flaky_dump):
        written = cp.flush_all()

    assert written == 1
    assert cp._dirty == {}  # cleared even on partial failure
    # Successful write landed.
    ok = load_document("sid-ok")
    assert ok is not None


def test_mark_dirty_overwrites_prior_doc_reference():
    cp = Checkpointer()
    cp.mark_dirty(_make_doc("sid-1", 0.1))
    cp.mark_dirty(_make_doc("sid-1", 0.9))
    # Only the latest reference flushes.
    cp.flush_all()
    data = load_document("sid-1")
    assert data is not None
    assert data["canonical"]["layer-1"]["basic"]["exposure"] == 0.9


@pytest.mark.asyncio
async def test_start_stop_lifecycle_drains_dirty(tmp_path: Path):
    cp = Checkpointer()
    cp.mark_dirty(_make_doc("sid-X"))

    # Patch the interval so the loop doesn't wait the full default.
    with patch(
        "app.session.checkpointer.get_app_config",
        return_value=type("F", (), {"runtime": type("R", (), {"checkpoint_interval_s": 0})()})(),
    ):
        await cp.start()
        # Yield once so the loop runs an iteration.
        await asyncio.sleep(0.05)
        await cp.stop()

    data = load_document("sid-X")
    assert data is not None
