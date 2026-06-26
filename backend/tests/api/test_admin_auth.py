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


def test_admin_uses_admin_token_not_the_public_backend_token(monkeypatch):
    """With the backend-token middleware active, /admin is exempt from it and
    gated only by ADMIN_TOKEN — so the public frontend token can't open it."""
    from app.config import app_config

    monkeypatch.setenv("BACKEND_AUTH_TOKEN", "frontendtok")
    monkeypatch.setenv("ADMIN_TOKEN", "admintok")
    app_config.get_settings.cache_clear()
    try:
        from app.main import create_app
        client = TestClient(create_app())
        # A normal API path IS gated by the backend-token middleware.
        assert client.get("/api/state/none").status_code == 401
        # /admin is exempt from that middleware and accepts ADMIN_TOKEN.
        assert client.get("/admin/sessions?token=admintok").status_code == 200
        # The public frontend token must NOT open admin.
        assert client.get("/admin/sessions?token=frontendtok").status_code == 403
    finally:
        app_config.get_settings.cache_clear()
