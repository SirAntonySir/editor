"""Per-image-node addressing of image_context + prepare_result on SessionDocument.

Mirrors test_image_bytes_per_node: new readers can ask for
`get_image_context(image_node_id)` / `get_prepare_result(image_node_id)`,
and `in-default` falls back to the legacy singleton so call sites can
migrate piecewise.
"""

from app.schemas.image_context import ImageContext
from app.state.document import SessionDocument


def _make_ctx(mood: str = "calm") -> ImageContext:
    return ImageContext(
        subjects=["test"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood=mood,
        model_name="m",
        model_version="v",
        generated_at="2026-06-15T00:00:00Z",
    )


def test_set_get_image_context_round_trip():
    doc = SessionDocument(session_id="s1")
    ctx1 = _make_ctx("calm")
    ctx2 = _make_ctx("bright")
    doc.set_image_context("in-1", ctx1)
    doc.set_image_context("in-2", ctx2)

    assert doc.get_image_context("in-1") is ctx1
    assert doc.get_image_context("in-2") is ctx2


def test_in_default_falls_back_to_legacy_singleton_image_context():
    ctx = _make_ctx("legacy")
    doc = SessionDocument(session_id="s1", image_context=ctx)
    assert doc.get_image_context("in-default") is ctx


def test_explicit_in_default_overrides_legacy_singleton_image_context():
    legacy = _make_ctx("legacy")
    fresh = _make_ctx("fresh")
    doc = SessionDocument(session_id="s1", image_context=legacy)
    doc.set_image_context("in-default", fresh)
    assert doc.get_image_context("in-default") is fresh


def test_unknown_node_returns_none_image_context():
    doc = SessionDocument(session_id="s1")
    assert doc.get_image_context("in-missing") is None


def test_set_image_context_does_not_clobber_legacy_singleton():
    legacy = _make_ctx("legacy")
    other = _make_ctx("other")
    doc = SessionDocument(session_id="s1", image_context=legacy)
    doc.set_image_context("in-1", other)
    assert doc.image_context is legacy


# ---------------- prepare_result ----------------


def test_set_get_prepare_result_round_trip():
    doc = SessionDocument(session_id="s1")
    pr1 = object()
    pr2 = object()
    doc.set_prepare_result("in-1", pr1)
    doc.set_prepare_result("in-2", pr2)

    assert doc.get_prepare_result("in-1") is pr1
    assert doc.get_prepare_result("in-2") is pr2


def test_in_default_falls_back_to_legacy_singleton_prepare_result():
    sentinel = object()
    doc = SessionDocument(session_id="s1")
    doc.prepare_result = sentinel
    assert doc.get_prepare_result("in-default") is sentinel


def test_explicit_in_default_overrides_legacy_singleton_prepare_result():
    legacy = object()
    fresh = object()
    doc = SessionDocument(session_id="s1")
    doc.prepare_result = legacy
    doc.set_prepare_result("in-default", fresh)
    assert doc.get_prepare_result("in-default") is fresh


def test_unknown_node_returns_none_prepare_result():
    doc = SessionDocument(session_id="s1")
    assert doc.get_prepare_result("in-missing") is None


def test_set_prepare_result_does_not_clobber_legacy_singleton():
    legacy = object()
    other = object()
    doc = SessionDocument(session_id="s1")
    doc.prepare_result = legacy
    doc.set_prepare_result("in-1", other)
    assert doc.prepare_result is legacy
