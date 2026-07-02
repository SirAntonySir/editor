"""SESSIONS_DIR honours the env override (used to point at a Render persistent
disk), and falls back to backend/.sessions when unset."""

from __future__ import annotations

import importlib
from pathlib import Path

import app.services.disk_session_io as dio


def test_env_override(monkeypatch):
    monkeypatch.setenv("SESSIONS_DIR", "/var/editor-sessions")
    try:
        importlib.reload(dio)
        assert dio.SESSIONS_DIR == Path("/var/editor-sessions")
    finally:
        monkeypatch.delenv("SESSIONS_DIR", raising=False)
        importlib.reload(dio)  # restore default for the rest of the suite


def test_default_without_env(monkeypatch):
    monkeypatch.delenv("SESSIONS_DIR", raising=False)
    importlib.reload(dio)
    assert dio.SESSIONS_DIR.name == ".sessions"
    assert dio.SESSIONS_DIR.parent.name == "backend"
