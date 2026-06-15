"""Persistence-layer per-node coverage.

The persisted document.v1.json MUST NOT carry per-node image bytes or
prepare_result (huge / regenerable). It MUST carry per-node image_context
(small, expensive to regenerate)."""

import json

from app.schemas.image_context import ImageContext
from app.services import disk_session_io
from app.session import persistence
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx() -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_dumped_document_excludes_per_node_image_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    doc = SessionDocument(session_id="s1")
    doc.set_image_bytes("in-1", b"AAAAAA", mime_type="image/jpeg")
    doc.set_image_bytes("in-2", b"BBBBBB", mime_type="image/jpeg")
    persistence.dump_document(doc, "s1")
    payload = json.loads((tmp_path / "s1" / "document.v1.json").read_text())
    assert "image_bytes_by_node" not in payload


def test_dumped_document_excludes_per_node_prepare_result(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    doc = SessionDocument(session_id="s1")
    doc.set_prepare_result("in-1", object())
    persistence.dump_document(doc, "s1")
    payload = json.loads((tmp_path / "s1" / "document.v1.json").read_text())
    assert "prepare_result_by_node" not in payload


def test_dumped_document_includes_per_node_image_context(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    doc = SessionDocument(session_id="s1")
    doc.set_image_context("in-1", _ctx())
    persistence.dump_document(doc, "s1")
    payload = json.loads((tmp_path / "s1" / "document.v1.json").read_text())
    assert "image_context_by_node" in payload
    assert payload["image_context_by_node"]["in-1"]["mood"] == "calm"
