"""Dismissed-widget GC — hard-deletes whose dismissal aged past history floor."""

from __future__ import annotations

import pytest

from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.state.document import SessionDocument


def _make_widget(wid: str = "w_1") -> Widget:
    return Widget(
        id=wid,
        intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def _doc() -> SessionDocument:
    return SessionDocument(session_id="sid", image_bytes=b"", mime_type="image/jpeg")


def test_gc_noop_on_active_widget():
    doc = _doc()
    doc.add_widget(_make_widget("w_active"))
    # Bury its creation revision under more history.
    for i in range(5):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    doc.prune_history(2)
    # Active widget survives no matter how old.
    removed = doc.gc_dismissed_widgets()
    assert removed == 0
    assert "w_active" in doc.widgets


def test_gc_noop_on_accepted_widget():
    doc = _doc()
    doc.add_widget(_make_widget("w_acc"))
    doc.accept_widget("w_acc")
    for i in range(5):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    doc.prune_history(2)
    assert doc.gc_dismissed_widgets() == 0
    assert "w_acc" in doc.widgets


def test_gc_keeps_recently_dismissed_widget():
    doc = _doc()
    doc.add_widget(_make_widget("w_recent"))
    doc.dismiss_widget("w_recent")
    # History still contains the dismissal — widget stays.
    assert doc.gc_dismissed_widgets() == 0
    assert "w_recent" in doc.widgets
    assert doc.widgets["w_recent"].dismissed_at_revision is not None


def test_gc_drops_dismissed_widget_after_history_aged_past():
    doc = _doc()
    doc.add_widget(_make_widget("w_old"))
    doc.dismiss_widget("w_old")
    dismissed_at = doc.widgets["w_old"].dismissed_at_revision
    assert dismissed_at is not None

    # Generate enough new events that the dismissal scrolls off the
    # bounded history.
    for i in range(50):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    doc.prune_history(10)
    # The history floor is now past the dismissal revision.
    assert doc.history[0].revision > dismissed_at

    removed = doc.gc_dismissed_widgets()
    assert removed == 1
    assert "w_old" not in doc.widgets
    assert "w_old" not in doc.widget_order


def test_restore_clears_dismissed_at_revision():
    doc = _doc()
    doc.add_widget(_make_widget("w_r"))
    doc.dismiss_widget("w_r")
    assert doc.widgets["w_r"].dismissed_at_revision is not None
    doc.restore_widget("w_r")
    assert doc.widgets["w_r"].dismissed_at_revision is None
    # After restore + prune, the (now-active) widget is never GC'd.
    for i in range(50):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    doc.prune_history(5)
    assert doc.gc_dismissed_widgets() == 0
    assert "w_r" in doc.widgets


def test_gc_on_empty_history_is_noop():
    doc = _doc()
    assert doc.gc_dismissed_widgets() == 0


def test_gc_ignores_legacy_widget_without_dismissed_at_revision():
    """Widgets persisted before the dismissed_at_revision field shipped
    have None for that field even after status=dismissed (no revive
    backfill). The GC must not delete those — losing a widget the user
    might still want to restore is worse than retaining one extra slot."""
    doc = _doc()
    doc.add_widget(_make_widget("w_legacy"))
    # Simulate the legacy state: dismissed but no revision marker.
    doc.widgets["w_legacy"].status = "dismissed"
    doc.widgets["w_legacy"].dismissed_at_revision = None
    for i in range(10):
        doc.set_param("layer-1", "basic", "exposure", float(i))
    doc.prune_history(3)
    assert doc.gc_dismissed_widgets() == 0
    assert "w_legacy" in doc.widgets
