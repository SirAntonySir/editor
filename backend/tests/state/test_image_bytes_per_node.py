"""Per-image-node addressing of image bytes on SessionDocument.

Additive layer over the existing singleton `image_bytes` / `mime_type` fields:
new readers can ask for `get_image_bytes(image_node_id)`, and `in-default`
falls back to the legacy singleton so call sites can migrate piecewise.
"""

from app.state.document import SessionDocument


def test_set_get_image_bytes_round_trip():
    doc = SessionDocument(session_id="s1")
    doc.set_image_bytes("in-1", b"AAAA", mime_type="image/png")
    doc.set_image_bytes("in-2", b"BBBB", mime_type="image/jpeg")

    assert doc.get_image_bytes("in-1") == b"AAAA"
    assert doc.get_image_bytes("in-2") == b"BBBB"
    assert doc.get_mime_type("in-1") == "image/png"
    assert doc.get_mime_type("in-2") == "image/jpeg"


def test_in_default_falls_back_to_legacy_singleton():
    """While call sites are migrating, the singleton `image_bytes` field
    still carries the primary image. `get_image_bytes('in-default')` must
    surface it when nothing has been explicitly stored under that key."""
    doc = SessionDocument(
        session_id="s1",
        image_bytes=b"LEGACY",
        mime_type="image/jpeg",
    )
    assert doc.get_image_bytes("in-default") == b"LEGACY"
    assert doc.get_mime_type("in-default") == "image/jpeg"


def test_explicit_in_default_overrides_legacy_singleton():
    doc = SessionDocument(
        session_id="s1",
        image_bytes=b"LEGACY",
        mime_type="image/jpeg",
    )
    doc.set_image_bytes("in-default", b"FRESH", mime_type="image/png")
    assert doc.get_image_bytes("in-default") == b"FRESH"
    assert doc.get_mime_type("in-default") == "image/png"


def test_unknown_node_returns_empty():
    doc = SessionDocument(session_id="s1")
    assert doc.get_image_bytes("in-missing") == b""
    assert doc.get_mime_type("in-missing") == "image/jpeg"  # neutral default


def test_set_image_bytes_does_not_clobber_legacy_singleton():
    """Storing to a node id other than `in-default` must leave the legacy
    primary-image singleton untouched, so unmigrated readers keep working."""
    doc = SessionDocument(
        session_id="s1",
        image_bytes=b"LEGACY",
        mime_type="image/jpeg",
    )
    doc.set_image_bytes("in-1", b"AAAA", mime_type="image/png")
    assert doc.image_bytes == b"LEGACY"
    assert doc.mime_type == "image/jpeg"
