from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_session_create_returns_id() -> None:
    client = TestClient(app)
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        response = client.post(
            "/api/session",
            files={"image": ("test.jpg", fh, "image/jpeg")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "session_id" in body
    assert len(body["session_id"]) == 32


def test_session_rejects_oversized_image(monkeypatch) -> None:
    # Force a tiny limit
    from app import config
    monkeypatch.setattr(config.get_settings(), "max_image_bytes", 10)
    client = TestClient(app)
    response = client.post(
        "/api/session",
        files={"image": ("big.jpg", b"x" * 100, "image/jpeg")},
    )
    assert response.status_code == 413


def test_session_rejects_non_image_mime() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/session",
        files={"image": ("file.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415
