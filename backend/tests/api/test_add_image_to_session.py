"""Tests for POST /api/session/{sid}/images — add a second image to an
existing session under a freshly-minted in-N image_node_id.

Companion to Task 4 of the multi-image-canvas delta plan."""

from fastapi.testclient import TestClient

from app.api.deps import get_session_store
from app.main import app


def test_add_image_creates_node_and_returns_id() -> None:
    c = TestClient(app)
    create = c.post("/api/session", files={"image": ("a.jpg", b"AAAA", "image/jpeg")})
    sid = create.json()["session_id"]

    add = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("b.png", b"BBBB", "image/png")},
    )
    assert add.status_code == 200
    new_id = add.json()["image_node_id"]
    assert new_id != "in-default"
    assert new_id.startswith("in-")
    # First added node should be in-1 (in-default occupies the n=0 slot).
    assert new_id == "in-1"


def test_add_image_mints_sequential_ids() -> None:
    c = TestClient(app)
    sid = c.post(
        "/api/session", files={"image": ("a.jpg", b"AAAA", "image/jpeg")}
    ).json()["session_id"]
    first = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("b.png", b"BBBB", "image/png")},
    ).json()["image_node_id"]
    second = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("c.png", b"CCCC", "image/png")},
    ).json()["image_node_id"]
    assert first == "in-1"
    assert second == "in-2"


def test_add_image_unknown_session_404() -> None:
    c = TestClient(app)
    r = c.post(
        "/api/session/does-not-exist/images",
        files={"image": ("b.png", b"BBBB", "image/png")},
    )
    assert r.status_code == 404


def test_add_image_too_large_413(monkeypatch) -> None:
    """Force a tiny upload limit, then upload bigger than that."""
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "max_image_bytes", 2, raising=False)
    c = TestClient(app)
    create = c.post("/api/session", files={"image": ("a.jpg", b"AB", "image/jpeg")})
    sid = create.json()["session_id"]
    r = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("b.png", b"BBBB", "image/png")},
    )
    assert r.status_code == 413


def test_add_image_rejects_non_image_mime() -> None:
    c = TestClient(app)
    sid = c.post(
        "/api/session", files={"image": ("a.jpg", b"AAAA", "image/jpeg")}
    ).json()["session_id"]
    r = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("b.txt", b"BBBB", "text/plain")},
    )
    assert r.status_code == 415


def test_add_image_persists_under_session_document() -> None:
    c = TestClient(app)
    create = c.post("/api/session", files={"image": ("a.jpg", b"AAAA", "image/jpeg")})
    sid = create.json()["session_id"]
    add = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("b.png", b"BBBB", "image/png")},
    )
    new_id = add.json()["image_node_id"]
    store = get_session_store()
    doc = store.get_document(sid)
    assert doc.get_image_bytes(new_id) == b"BBBB"
    assert doc.get_mime_type(new_id) == "image/png"
    # Per-node doctrine: primary image lives in image_bytes_by_node["in-default"],
    # not the legacy singleton (which is left empty for fresh sessions).
    assert doc.get_image_bytes("in-default") == b"AAAA"
    assert doc.get_mime_type("in-default") == "image/jpeg"
    assert doc.image_bytes == b""


def test_add_image_persists_to_disk(tmp_path, monkeypatch) -> None:
    """The added image survives a server restart by being written to disk
    next to the primary image, keyed by image_node_id."""
    from app.services import disk_session_io

    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    c = TestClient(app)
    sid = c.post(
        "/api/session", files={"image": ("a.jpg", b"AAAA", "image/jpeg")}
    ).json()["session_id"]
    new_id = c.post(
        f"/api/session/{sid}/images",
        files={"image": ("b.png", b"BBBB", "image/png")},
    ).json()["image_node_id"]

    # The disk helper places the file next to the primary image.
    session_dir = tmp_path / sid
    assert session_dir.exists()
    # Look for a file whose stem encodes the image_node_id.
    found = list(session_dir.glob(f"{new_id}.*"))
    assert len(found) == 1, f"expected one file for {new_id}, got {found}"
    assert found[0].read_bytes() == b"BBBB"
