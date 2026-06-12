"""Bounded history — _emit accumulates, prune_history drops the oldest FIFO."""

from __future__ import annotations

from app.state.document import SessionDocument


def _make_doc() -> SessionDocument:
    return SessionDocument(session_id="sid", image_bytes=b"", mime_type="image/jpeg")


def test_prune_drops_oldest_when_over_cap():
    doc = _make_doc()
    for i in range(20):
        doc.set_param("layer-1", "basic", "exposure", float(i))

    assert len(doc.history) == 20
    dropped = doc.prune_history(5)
    assert dropped == 15
    assert len(doc.history) == 5
    # The five newest are kept (exposure values 15..19).
    kept_values = [ev.payload["value"] for ev in doc.history]
    assert kept_values == [15.0, 16.0, 17.0, 18.0, 19.0]


def test_prune_noop_when_under_cap():
    doc = _make_doc()
    for i in range(3):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    assert doc.prune_history(10) == 0
    assert len(doc.history) == 3


def test_prune_keeps_published_idx_consistent():
    doc = _make_doc()
    # Simulate a flush after 4 mutations (everything published).
    for i in range(4):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    doc._published_idx = len(doc.history)
    assert doc._published_idx == 4

    # Two more, then prune to 3.
    doc.set_param("layer-1", "basic", "exposure", 99.0)
    doc.set_param("layer-1", "basic", "exposure", 100.0)
    # history is now 6 entries, _published_idx still 4.
    assert len(doc.history) == 6
    assert doc._published_idx == 4

    dropped = doc.prune_history(3)
    assert dropped == 3
    # After drop: history len 3, _published_idx must shift down by 3
    # → max(0, 4-3) = 1. That's the count of still-published entries kept.
    assert doc._published_idx == 1
    # The 3 kept entries are the last 3 (one published, two not).
    assert len(doc.history) == 3


def test_prune_returns_zero_at_exact_cap():
    doc = _make_doc()
    for i in range(5):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    assert doc.prune_history(5) == 0
    assert len(doc.history) == 5
