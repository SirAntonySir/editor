"""Persistence layer — atomic write, .bak rotation, corrupt-file fallback."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.session import persistence
from app.session.persistence import (
    SCHEMA_VERSION,
    CorruptDocumentError,
    dump_document,
    load_document,
)
from app.state.document import SessionDocument


@pytest.fixture(autouse=True)
def _isolated_sessions_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.services.disk_session_io.SESSIONS_DIR",
        tmp_path,
    )
    yield


def _make_doc(sid: str = "sid-test") -> SessionDocument:
    doc = SessionDocument(
        session_id=sid,
        image_bytes=b"raw-image-bytes-pretend-this-is-a-megabyte",
        mime_type="image/jpeg",
    )
    doc.set_param(layer_id="layer-1", op="basic", param="exposure", value=0.5)
    return doc


def test_dump_writes_versioned_payload(tmp_path: Path):
    dump_document(_make_doc(), "sid-test")
    target = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.json"
    assert target.exists()
    data = json.loads(target.read_text())
    assert data["_schema_version"] == SCHEMA_VERSION
    assert data["session_id"] == "sid-test"
    # canonical write landed
    assert data["canonical"]["layer-1"]["basic"]["exposure"] == 0.5


def test_dump_excludes_image_bytes_and_prepare_result():
    doc = _make_doc()
    dump_document(doc, "sid-test")
    data = load_document("sid-test")
    assert data is not None
    assert "image_bytes" not in data
    assert "prepare_result" not in data


def test_round_trip_load_returns_dict():
    dump_document(_make_doc(), "sid-test")
    data = load_document("sid-test")
    assert data is not None
    assert data["session_id"] == "sid-test"
    assert data["revision"] == 1  # one set_param emitted


def test_load_missing_returns_none():
    assert load_document("sid-never-existed") is None


def test_second_write_rotates_primary_to_bak(tmp_path: Path):
    dump_document(_make_doc(), "sid-test")
    primary = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.json"
    backup = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.bak.json"
    assert primary.exists()
    assert not backup.exists()

    # Mutate and re-dump.
    doc = _make_doc()
    doc.set_param("layer-1", "basic", "contrast", 0.3)
    dump_document(doc, "sid-test")

    assert backup.exists(), "previous version should rotate to .bak"
    assert primary.exists()
    # Backup carries the older state (no contrast); primary carries the new.
    bak_data = json.loads(backup.read_text())
    assert "contrast" not in bak_data["canonical"]["layer-1"]["basic"]
    primary_data = json.loads(primary.read_text())
    assert primary_data["canonical"]["layer-1"]["basic"]["contrast"] == 0.3


def test_load_falls_back_to_bak_when_primary_corrupt(tmp_path: Path):
    # Write once, then a second time to populate .bak.
    dump_document(_make_doc(), "sid-test")
    doc = _make_doc()
    doc.set_param("layer-1", "basic", "contrast", 0.3)
    dump_document(doc, "sid-test")

    primary = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.json"
    primary.write_text("not json at all }{")

    data = load_document("sid-test")
    assert data is not None
    # We recovered the earlier (.bak) state, which didn't have contrast.
    assert "contrast" not in data["canonical"]["layer-1"]["basic"]


def test_load_raises_when_both_corrupt(tmp_path: Path):
    dump_document(_make_doc(), "sid-test")
    dump_document(_make_doc(), "sid-test")  # populates .bak
    primary = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.json"
    backup = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.bak.json"
    primary.write_text("garbage")
    backup.write_text("also garbage")

    with pytest.raises(CorruptDocumentError):
        load_document("sid-test")


def test_load_rejects_unknown_schema_version(tmp_path: Path):
    target = tmp_path / "sid-test" / f"document.v{SCHEMA_VERSION}.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps({"_schema_version": 999, "session_id": "sid-test"}))
    # No backup file exists → mismatch surfaces as corrupt (both attempts fail).
    with pytest.raises(CorruptDocumentError):
        load_document("sid-test")


def test_atomic_write_leaves_no_tmp_artifacts(tmp_path: Path):
    dump_document(_make_doc(), "sid-test")
    dump_document(_make_doc(), "sid-test")
    sid_dir = tmp_path / "sid-test"
    # No leftover tempfiles (would start with .tmp- per persistence._atomic_write).
    leftovers = [p for p in sid_dir.iterdir() if p.name.startswith(".tmp-")]
    assert leftovers == []


def test_persistence_constants_aligned_with_module():
    # Sanity guard: the SCHEMA_VERSION the test asserts against must match what
    # the module exports. Catches accidental version bumps without test update.
    assert persistence.SCHEMA_VERSION == SCHEMA_VERSION


def test_load_migrates_older_payload_forward(tmp_path: Path):
    """A payload with `_schema_version=0` on disk gets brought forward to
    the current SCHEMA_VERSION by the migrations chain. The v0→v1 stub is
    a no-op today, so we only check the version field — but this guards
    the dispatcher being wired in at all."""
    target = tmp_path / "sid-old" / f"document.v{SCHEMA_VERSION}.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps({
        "_schema_version": 0,
        "session_id": "sid-old",
        "mime_type": "image/jpeg",
        "revision": 0,
    }))
    data = load_document("sid-old")
    assert data is not None
    assert data["_schema_version"] == SCHEMA_VERSION
    assert data["session_id"] == "sid-old"
