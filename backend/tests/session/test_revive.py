"""Revive — restore persisted SessionDocuments on startup."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services import disk_session_io
from app.services.session_store import SessionStore
from app.session import persistence, revive
from app.session.persistence import SCHEMA_VERSION
from app.state.document import SessionDocument


@pytest.fixture(autouse=True)
def _isolated_sessions_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    yield


def _persist_session(sid: str, *, exposure: float = 0.5) -> None:
    disk_session_io.save_session(sid, b"image-bytes", "image/jpeg", created_at=1000.0)
    doc = SessionDocument(session_id=sid, image_bytes=b"image-bytes", mime_type="image/jpeg")
    doc.set_param("layer-1", "basic", "exposure", exposure)
    persistence.dump_document(doc, sid)


def test_revive_empty_dir_returns_zero(tmp_path: Path):
    # Even with no SESSIONS_DIR at all, we don't crash.
    store = SessionStore(ttl_seconds=3600)
    assert revive.revive_all(store) == 0


def test_revive_round_trip_restores_state():
    _persist_session("sid-1", exposure=0.7)
    store = SessionStore(ttl_seconds=3600)
    assert revive.revive_all(store) == 1

    from app.state.document import DEFAULT_IMAGE_NODE_ID
    doc = store.get_document("sid-1")
    assert doc.canonical["layer-1"]["basic"]["exposure"] == 0.7
    # Revision was bumped once by set_param.
    assert doc.revision == 1
    # image_bytes promoted to per-node store; legacy singleton is cleared.
    assert doc.get_image_bytes(DEFAULT_IMAGE_NODE_ID) == b"image-bytes"
    assert doc.image_bytes == b""


def test_revive_skips_session_without_document(tmp_path: Path):
    # Image present but no document.v1.json — common case (fresh session).
    disk_session_io.save_session("sid-fresh", b"img", "image/jpeg", created_at=1000.0)
    store = SessionStore(ttl_seconds=3600)
    assert revive.revive_all(store) == 0
    # The session isn't pre-loaded — but get() still hydrates it lazily.
    rec = store.get("sid-fresh")
    assert rec.image_bytes == b"img"


def test_revive_skips_corrupt_document(tmp_path: Path):
    _persist_session("sid-good")
    _persist_session("sid-bad")
    # Corrupt sid-bad's primary AND backup so the loader gives up.
    primary = tmp_path / "sid-bad" / f"document.v{SCHEMA_VERSION}.json"
    backup = tmp_path / "sid-bad" / f"document.v{SCHEMA_VERSION}.bak.json"
    primary.write_text("not json")
    if backup.exists():
        backup.write_text("not json")

    store = SessionStore(ttl_seconds=3600)
    count = revive.revive_all(store)
    assert count == 1  # only sid-good came back
    # And we can fetch the good one.
    doc = store.get_document("sid-good")
    assert doc.revision == 1


def test_revive_is_idempotent():
    _persist_session("sid-1")
    store = SessionStore(ttl_seconds=3600)
    # Two calls — second is a no-op overwrite, doesn't error.
    revive.revive_all(store)
    revive.revive_all(store)
    doc = store.get_document("sid-1")
    assert doc.revision == 1
