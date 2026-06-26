"""HTTP round-trip for POST /api/raw/develop — RAW bytes in, JPEG out."""

from __future__ import annotations

import io
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "synthetic.dng"


def _client() -> TestClient:
    from app.main import app
    return TestClient(app)


def test_develop_returns_jpeg():
    client = _client()
    r = client.post(
        "/api/raw/develop",
        files={"image": ("synthetic.dng", FIXTURE.read_bytes(), "image/x-adobe-dng")},
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(r.content))
    assert img.format == "JPEG"
    assert img.size == (192, 192)


def test_develop_rejects_non_raw_with_415():
    client = _client()
    r = client.post(
        "/api/raw/develop",
        files={"image": ("not.dng", b"plainly not a raw file", "image/x-adobe-dng")},
    )
    assert r.status_code == 415
