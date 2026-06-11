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
    assert isinstance(doc.image_context, EnrichedImageContext)
    assert doc.image_context.subjects == ["x"]
    assert doc.image_context.grade_character == "neutral"
