"""Cohort (participant) AI_access settings + inheritance on session create."""

from __future__ import annotations

import pytest

from app.services import cohort_store
from app.services.session_store import SessionStore


@pytest.fixture(autouse=True)
def _isolate_sessions_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)


def test_unknown_cohort_defaults_true():
    assert cohort_store.get_cohort_ai_access("never-seen") is True


def test_empty_user_id_defaults_true_and_set_is_noop():
    assert cohort_store.get_cohort_ai_access(None) is True
    assert cohort_store.get_cohort_ai_access("") is True
    cohort_store.set_cohort_ai_access("", False)  # no-op, must not raise
    assert cohort_store.get_cohort_ai_access("") is True


def test_set_then_get_roundtrip():
    cohort_store.set_cohort_ai_access("user-1", False)
    assert cohort_store.get_cohort_ai_access("user-1") is False
    cohort_store.set_cohort_ai_access("user-1", True)
    assert cohort_store.get_cohort_ai_access("user-1") is True


def test_cohorts_are_independent():
    cohort_store.set_cohort_ai_access("user-a", False)
    assert cohort_store.get_cohort_ai_access("user-a") is False
    assert cohort_store.get_cohort_ai_access("user-b") is True


def test_new_session_inherits_cohort_value():
    """The core fix: a session created with the cohort's AI_access default
    carries that value (so reload / new-image sessions stay in condition)."""
    ai_access = cohort_store.get_cohort_ai_access("ctrl-participant")  # True default
    store = SessionStore(ttl_seconds=3600)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg", ai_access=ai_access)
    assert store.get(sid).ai_access is True

    cohort_store.set_cohort_ai_access("ctrl-participant", False)
    ai_access = cohort_store.get_cohort_ai_access("ctrl-participant")
    sid2 = store.create(image_bytes=b"y", mime_type="image/jpeg", ai_access=ai_access)
    assert store.get(sid2).ai_access is False
