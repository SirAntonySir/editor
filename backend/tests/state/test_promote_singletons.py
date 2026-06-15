"""_promote_singletons_to_per_node — one-shot migration of legacy singletons
into the per-image-node dicts. Idempotent. Runs on revive so freshly-loaded
v1 documents converge to the per-node-only doctrine."""

from app.schemas.image_context import ImageContext
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx() -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_promotes_legacy_image_bytes_into_in_default():
    doc = SessionDocument(session_id="s1", image_bytes=b"LEGACY", mime_type="image/png")
    doc._promote_singletons_to_per_node()
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"LEGACY"
    assert doc.mime_type_by_node[DEFAULT_IMAGE_NODE_ID] == "image/png"
    assert doc.image_bytes == b""
    assert doc.mime_type == "image/jpeg"  # neutral default after clear


def test_promotes_legacy_image_context_into_in_default():
    ctx = _ctx()
    doc = SessionDocument(session_id="s1", image_context=ctx)
    doc._promote_singletons_to_per_node()
    assert doc.image_context_by_node[DEFAULT_IMAGE_NODE_ID] is ctx
    assert doc.image_context is None


def test_promotes_legacy_prepare_result_into_in_default():
    sentinel = object()
    doc = SessionDocument(session_id="s1")
    doc.prepare_result = sentinel
    doc._promote_singletons_to_per_node()
    assert doc.prepare_result_by_node[DEFAULT_IMAGE_NODE_ID] is sentinel
    assert doc.prepare_result is None


def test_per_node_wins_when_both_populated():
    """If a writer already moved to per-node-only AND a legacy singleton is
    still present (e.g. a halfway-migrated payload), the per-node entry is
    the source of truth and the singleton is just cleared."""
    legacy_ctx = _ctx()
    fresh_ctx = ImageContext(
        subjects=["fresh"], lighting="flat", dominant_tones=["midtones"], mood="bright",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )
    doc = SessionDocument(session_id="s1", image_context=legacy_ctx)
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, fresh_ctx)
    doc._promote_singletons_to_per_node()
    assert doc.image_context_by_node[DEFAULT_IMAGE_NODE_ID] is fresh_ctx
    assert doc.image_context is None


def test_no_op_on_fully_per_node_doc():
    doc = SessionDocument(session_id="s1")
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, b"X", mime_type="image/png")
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx())
    doc._promote_singletons_to_per_node()
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"X"
    assert doc.image_bytes == b""


def test_idempotent():
    doc = SessionDocument(session_id="s1", image_bytes=b"X", mime_type="image/png")
    doc._promote_singletons_to_per_node()
    doc._promote_singletons_to_per_node()  # second call is a no-op
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"X"
    assert doc.image_bytes == b""
