"""Admin gate: loopback OR a valid ADMIN_TOKEN (separate from BACKEND_AUTH_TOKEN).

Starlette's TestClient presents a non-loopback peer host ("testclient"), so
these exercise the remote-access branch of `_require_loopback`.
"""

from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


def _patch_token(monkeypatch, token: str) -> None:
    import app.api.admin as admin
    monkeypatch.setattr(admin, "get_settings", lambda: SimpleNamespace(admin_token=token))


def test_remote_blocked_when_no_token_configured(monkeypatch):
    _patch_token(monkeypatch, "")
    r = _client().get("/admin/sessions")
    assert r.status_code == 403


def test_remote_allowed_with_correct_query_token(monkeypatch):
    _patch_token(monkeypatch, "sekret")
    r = _client().get("/admin/sessions?token=sekret")
    assert r.status_code == 200


def test_remote_allowed_with_bearer_token(monkeypatch):
    _patch_token(monkeypatch, "sekret")
    r = _client().get("/admin/sessions", headers={"Authorization": "Bearer sekret"})
    assert r.status_code == 200


def test_remote_rejected_with_wrong_token(monkeypatch):
    _patch_token(monkeypatch, "sekret")
    r = _client().get("/admin/sessions?token=nope")
    assert r.status_code == 403
