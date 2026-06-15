"""SessionStore disk persistence — survival across instances + rehydration."""

import time

import pytest


@pytest.fixture(autouse=True)
def isolated_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    yield


def test_session_survives_store_recreation():
    """Mimics a backend restart: create in store A, get in store B."""
    from app.services.session_store import SessionStore

    a = SessionStore(ttl_seconds=999)
    sid = a.create(b"image-bytes", "image/jpeg")
    a.set_context(sid, {"subjects": ["x"], "candidateRegions": []})

    b = SessionStore(ttl_seconds=999)
    rec = b.get(sid)
    assert rec.image_bytes == b"image-bytes"
    assert rec.context == {"subjects": ["x"], "candidateRegions": []}


def test_missing_session_raises():
    from app.services.session_store import SessionNotFound, SessionStore

    s = SessionStore(ttl_seconds=999)
    with pytest.raises(SessionNotFound):
        s.get("never-existed")


def test_expired_in_memory_falls_back_to_disk():
    """In-memory record expires but disk persists → get() rehydrates."""
    from app.services.session_store import SessionStore

    s = SessionStore(ttl_seconds=0.01)  # 10ms TTL
    sid = s.create(b"img", "image/jpeg")
    time.sleep(0.05)
    # In-memory record is expired; get() should hit disk and return.
    rec = s.get(sid)
    assert rec.image_bytes == b"img"


def test_get_document_rehydrates_enriched_context():
    """After backend restart, the first get_document loads image_context
    from disk so the next analyze can short-circuit."""
    from app.services.session_store import SessionStore

    # Build a minimal valid EnrichedImageContext dict (camelCase wire shape).
    ec_dict = {
        "subjects": ["x"],
        "lighting": "flat",
        "dominantTones": ["midtones"],
        "mood": "m",
        "candidateRegions": [],
        "modelName": "t",
        "modelVersion": "1",
        "generatedAt": "2026-06-11T00:00:00Z",
        # Enriched fields with defaults
        "lumaHistogram": [0] * 256,
        "rgbHistograms": {"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        "clippedShadowsPct": 0.0,
        "clippedHighlightsPct": 0.0,
        "medianLuma": 0.5,
        "contrastP10P90": 1.0,
        "colorPalette": [],
        "castStrength": 0.0,
        "castDirection": [0.0, 0.0],
        "regionStats": [],
        "estimatedWhitePoint": [255.0, 255.0, 255.0],
        "wbNeutralConfidence": 1.0,
        "gradeCharacter": "neutral",
        "problems": [],
    }
    a = SessionStore(ttl_seconds=999)
    sid = a.create(b"img", "image/jpeg")
    a.set_context(sid, ec_dict)

    # New store = restart simulation.
    b = SessionStore(ttl_seconds=999)
    doc = b.get_document(sid)
    from app.schemas.enriched_context import EnrichedImageContext
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
    assert isinstance(ctx, EnrichedImageContext)
    assert ctx.subjects == ["x"]
    assert ctx.grade_character == "neutral"


def test_prune_disk_removes_old_records(tmp_path, monkeypatch):
    """prune_disk removes sessions whose created_at exceeds max_age, keeps
    fresh ones."""
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    import json
    import time as _t

    sid_old = "old-sid"
    sid_new = "new-sid"
    for sid, ts in ((sid_old, _t.time() - 10_000), (sid_new, _t.time())):
        d = tmp_path / sid
        d.mkdir()
        (d / "meta.json").write_text(
            json.dumps({"mime_type": "image/jpeg", "created_at": ts}),
        )
        (d / "image.jpg").write_bytes(b"x")

    from app.services.session_store import SessionStore
    pruned = SessionStore(ttl_seconds=1).prune_disk(max_age_seconds=3600)
    assert pruned == 1
    assert not (tmp_path / sid_old).exists()
    assert (tmp_path / sid_new).exists()


def test_prune_disk_skips_entries_without_meta(tmp_path, monkeypatch):
    """Bare directories without meta.json don't crash prune_disk."""
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    (tmp_path / "stray-dir").mkdir()
    (tmp_path / "stray-file").write_text("oops")

    from app.services.session_store import SessionStore
    pruned = SessionStore(ttl_seconds=1).prune_disk(max_age_seconds=60)
    assert pruned == 0
    assert (tmp_path / "stray-dir").exists()
    assert (tmp_path / "stray-file").exists()


def test_prune_disk_handles_missing_sessions_dir(tmp_path, monkeypatch):
    """No SESSIONS_DIR → 0 pruned, no error."""
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path / "nope")
    from app.services.session_store import SessionStore
    pruned = SessionStore(ttl_seconds=1).prune_disk(max_age_seconds=60)
    assert pruned == 0
