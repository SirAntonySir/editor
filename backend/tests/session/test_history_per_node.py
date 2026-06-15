"""Per-image-node image_context must survive undo/redo/revert."""

from app.schemas.image_context import ImageContext
from app.session.history import Snapshot
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx(mood: str) -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood=mood,
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_snapshot_capture_includes_image_context_by_node():
    doc = SessionDocument(session_id="s1")
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("calm"))
    doc.set_image_context("in-2", _ctx("bright"))
    snap = Snapshot.capture(doc)
    assert snap.image_context_by_node[DEFAULT_IMAGE_NODE_ID]["mood"] == "calm"
    assert snap.image_context_by_node["in-2"]["mood"] == "bright"


def test_apply_snapshot_restores_image_context_by_node():
    doc = SessionDocument(session_id="s1")
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("calm"))
    snap = Snapshot.capture(doc)
    # Now mutate the doc as if a tool ran.
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("excited"))
    assert doc.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "excited"
    # Apply the older snapshot — should roll back to "calm".
    doc.apply_snapshot(snap)
    assert doc.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "calm"


def test_apply_snapshot_clears_legacy_singleton_image_context():
    """Whatever apply_snapshot writes must leave the legacy singleton empty —
    the per-node dict is the only canonical storage."""
    doc = SessionDocument(session_id="s1")
    doc.image_context = _ctx("legacy")  # pretend a pre-migration writer set this
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("per-node"))
    snap = Snapshot.capture(doc)
    doc.apply_snapshot(snap)
    assert doc.image_context is None
    assert doc.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "per-node"
