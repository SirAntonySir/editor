"""Admin session summary: legacy metas that persisted time.monotonic() as
created_at (seconds since boot → 1970-adjacent dates) fall back to the meta
file's mtime; sane wall-clock stamps pass through untouched."""
from __future__ import annotations

import json
import time

from app.api.admin import _summarize_session


def test_legacy_monotonic_created_at_falls_back_to_mtime(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    sid = "legacy1"
    d = tmp_path / sid
    d.mkdir(parents=True)
    meta_path = d / "meta.json"
    meta_path.write_text(json.dumps({
        "mime_type": "image/jpeg",
        "created_at": 398_771.0,  # time.monotonic() garbage: ~4.6 days uptime
        "ai_access": True,
    }))
    summary = _summarize_session(sid)
    assert summary["created_at"] == meta_path.stat().st_mtime


def test_wall_clock_created_at_passes_through(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    sid = "modern1"
    d = tmp_path / sid
    d.mkdir(parents=True)
    stamp = time.time() - 3600
    (d / "meta.json").write_text(json.dumps({
        "mime_type": "image/jpeg",
        "created_at": stamp,
        "ai_access": True,
    }))
    summary = _summarize_session(sid)
    assert summary["created_at"] == stamp
