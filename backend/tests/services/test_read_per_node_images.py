"""disk_session_io.read_per_node_images — scan a session dir for any
per-image-node image files (`<image_node_id>.<ext>`, NOT the primary
`image.<ext>`) and return them as a mapping. Used by revive to restore
SessionDocument.image_bytes_by_node + mime_type_by_node."""

from app.services import disk_session_io


def test_returns_empty_for_no_session_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    assert disk_session_io.read_per_node_images("ghost") == {}


def test_skips_primary_image_file(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"primary", "image/jpeg", created_at=0.0)
    assert disk_session_io.read_per_node_images("s1") == {}


def test_returns_per_node_images(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"primary", "image/jpeg", created_at=0.0)
    disk_session_io.write_image("s1", "in-1", b"AAAA", "image/png")
    disk_session_io.write_image("s1", "in-2", b"BBBB", "image/webp")
    result = disk_session_io.read_per_node_images("s1")
    assert result == {
        "in-1": (b"AAAA", "image/png"),
        "in-2": (b"BBBB", "image/webp"),
    }


def test_ignores_unknown_extensions(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"primary", "image/jpeg", created_at=0.0)
    (tmp_path / "s1" / "notes.txt").write_text("hi")
    (tmp_path / "s1" / "meta.json").write_text("{}")  # already there
    assert disk_session_io.read_per_node_images("s1") == {}
