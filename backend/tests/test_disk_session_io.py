"""Disk I/O helpers — round-trip, missing inputs, delete cleanup."""

import json
from pathlib import Path

import pytest

from app.services.disk_session_io import (
    delete_session, load_session, save_context, save_session,
)


@pytest.fixture(autouse=True)
def isolated_dir(tmp_path, monkeypatch):
    """Each test gets its own SESSIONS_DIR under tmp_path."""
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    yield


def test_save_and_load_round_trip():
    save_session("sid-1", b"jpegbytes", "image/jpeg", created_at=1000.0)
    save_context("sid-1", {"hello": "world"})

    rec = load_session("sid-1")
    assert rec is not None
    assert rec.image_bytes == b"jpegbytes"
    assert rec.mime_type == "image/jpeg"
    assert rec.created_at == 1000.0
    assert rec.context_json == {"hello": "world"}


def test_load_missing_returns_none():
    assert load_session("does-not-exist") is None


def test_load_without_context_returns_record_with_none_context():
    save_session("sid-2", b"x", "image/png", created_at=2000.0)
    rec = load_session("sid-2")
    assert rec is not None
    assert rec.context_json is None


def test_load_with_corrupt_meta_returns_none(tmp_path):
    d = tmp_path / "bad-sid"
    d.mkdir()
    (d / "meta.json").write_text("not valid json")
    assert load_session("bad-sid") is None


def test_load_with_corrupt_context_returns_record_with_none_context(tmp_path):
    save_session("sid-3", b"x", "image/jpeg", created_at=3000.0)
    d = tmp_path / "sid-3"
    (d / "context.json").write_text("not valid json")
    rec = load_session("sid-3")
    assert rec is not None
    assert rec.context_json is None


def test_delete_session_removes_dir(tmp_path):
    save_session("sid-4", b"x", "image/png", created_at=0.0)
    save_context("sid-4", {"k": "v"})
    assert (tmp_path / "sid-4").exists()
    delete_session("sid-4")
    assert not (tmp_path / "sid-4").exists()
    assert load_session("sid-4") is None


def test_delete_missing_session_is_noop():
    delete_session("never-existed")  # must not raise


def test_save_context_creates_dir_when_missing(tmp_path):
    """If save_context is called before save_session, the dir is created."""
    save_context("sid-orphan", {"k": "v"})
    rec_dir = tmp_path / "sid-orphan"
    assert rec_dir.exists()
    assert (rec_dir / "context.json").exists()


# ----------------------------------------------------------------------
# Legacy doubly-nested SESSIONS_DIR migration
# ----------------------------------------------------------------------

def test_migrate_legacy_sessions_dir_moves_directories(tmp_path, monkeypatch):
    """When sessions exist at the legacy `<backend>/backend/.sessions/`
    path (the cwd-relative artefact of `cd backend && uvicorn ...`), the
    migration moves their directories into the canonical SESSIONS_DIR
    on startup. The legacy path sits next to the canonical SESSIONS_DIR
    inside the backend root, not nested under it."""
    from app.services import disk_session_io

    canonical = tmp_path / ".sessions"
    canonical.mkdir()
    monkeypatch.setattr(disk_session_io, "_BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", canonical)

    legacy = tmp_path / "backend" / ".sessions"
    legacy.mkdir(parents=True)
    (legacy / "abc123").mkdir()
    (legacy / "abc123" / "meta.json").write_text('{"created_at": 0}')
    (legacy / "def456").mkdir()
    (legacy / "def456" / "events.jsonl").write_text("")

    moved = disk_session_io.migrate_legacy_sessions_dir()

    assert moved == 2
    assert (canonical / "abc123" / "meta.json").exists()
    assert (canonical / "def456" / "events.jsonl").exists()
    # Legacy entries gone after move.
    assert not (legacy / "abc123").exists()
    assert not (legacy / "def456").exists()


def test_migrate_legacy_sessions_dir_no_legacy_is_noop(tmp_path, monkeypatch):
    from app.services import disk_session_io
    canonical = tmp_path / ".sessions"
    canonical.mkdir()
    monkeypatch.setattr(disk_session_io, "_BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", canonical)
    assert disk_session_io.migrate_legacy_sessions_dir() == 0


def test_migrate_legacy_sessions_dir_does_not_clobber(tmp_path, monkeypatch):
    """If a session with the same id already exists in the canonical
    location, the legacy entry is left in place (the user can resolve
    the collision by hand). Documents the conservative semantic."""
    from app.services import disk_session_io
    canonical = tmp_path / ".sessions"
    canonical.mkdir()
    monkeypatch.setattr(disk_session_io, "_BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", canonical)

    # Canonical session present.
    (canonical / "abc123").mkdir()
    (canonical / "abc123" / "meta.json").write_text('{"canonical": true}')

    # Legacy session with same id.
    legacy = tmp_path / "backend" / ".sessions" / "abc123"
    legacy.mkdir(parents=True)
    (legacy / "meta.json").write_text('{"canonical": false}')

    moved = disk_session_io.migrate_legacy_sessions_dir()
    assert moved == 0
    assert legacy.exists()
    # Canonical content untouched.
    assert json.loads((canonical / "abc123" / "meta.json").read_text()) == {"canonical": True}
