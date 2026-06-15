"""End-to-end revive: persisted v1 document + per-node disk images →
rehydrated SessionDocument with the per-node-only doctrine applied."""

import time

from app.services import disk_session_io
from app.services.session_store import SessionStore
from app.session import persistence, revive
from app.state.document import DEFAULT_IMAGE_NODE_ID


def test_revive_rebuilds_image_bytes_by_node_from_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    # Stage a session with one primary + two per-node images on disk.
    disk_session_io.save_session("s1", b"PRIMARY", "image/jpeg", created_at=time.time())
    disk_session_io.write_image("s1", "in-1", b"AAAA", "image/png")
    disk_session_io.write_image("s1", "in-2", b"BBBB", "image/webp")
    # Persist a minimal document — no image_bytes (will be added by revive).
    from app.state.document import SessionDocument
    doc = SessionDocument(session_id="s1")
    persistence.dump_document(doc, "s1")

    store = SessionStore(ttl_seconds=60)
    n = revive.revive_all(store)
    assert n == 1
    revived = store.get_document("s1")
    # Primary image lives at in-default in the per-node dict.
    assert revived.get_image_bytes(DEFAULT_IMAGE_NODE_ID) == b"PRIMARY"
    assert revived.image_bytes == b""  # legacy singleton has been cleared
    assert revived.get_image_bytes("in-1") == b"AAAA"
    assert revived.get_image_bytes("in-2") == b"BBBB"
    assert revived.get_mime_type("in-1") == "image/png"


def test_revive_promotes_legacy_singletons_from_persisted_payload(tmp_path, monkeypatch):
    """A document persisted BEFORE the migration carries data in the legacy
    `image_context` singleton. Revive must promote it into the per-node dict."""
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"PRIMARY", "image/jpeg", created_at=time.time())
    # Build a v1 doc the old way (singleton image_context).
    from app.schemas.image_context import ImageContext
    from app.state.document import SessionDocument
    ctx = ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )
    doc = SessionDocument(session_id="s1", image_context=ctx)
    persistence.dump_document(doc, "s1")

    store = SessionStore(ttl_seconds=60)
    revive.revive_all(store)
    revived = store.get_document("s1")
    assert revived.image_context is None
    assert revived.get_image_context(DEFAULT_IMAGE_NODE_ID) is not None
    assert revived.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "calm"
