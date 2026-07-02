"""GET /api/session/{sid}/assets/{asset_id} — genfill result asset serving."""

from fastapi.testclient import TestClient

from app.main import app
from app.services import disk_session_io as dio


def test_asset_route_serves_png(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    dio.write_asset("s1", "genfill-w_1", b"PNG")
    c = TestClient(app)
    ok = c.get("/api/session/s1/assets/genfill-w_1")
    assert ok.status_code == 200
    assert ok.content == b"PNG"
    assert ok.headers["content-type"] == "image/png"


def test_asset_route_404s(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    dio.write_asset("s1", "genfill-w_1", b"PNG")
    c = TestClient(app)
    # Non-genfill namespace → 404 even if a file existed
    assert c.get("/api/session/s1/assets/other-w_1").status_code == 404
    # Missing asset → 404
    assert c.get("/api/session/s1/assets/genfill-missing").status_code == 404
    # Traversal-shaped ids never match the pattern
    assert c.get("/api/session/s1/assets/genfill-..%2Fescape").status_code == 404
