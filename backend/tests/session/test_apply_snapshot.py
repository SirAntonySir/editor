"""apply_snapshot round-trip on SessionDocument."""

from __future__ import annotations

from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.session.history import Snapshot
from app.state.document import SessionDocument


def _make_widget(wid: str, intent: str = "warm") -> Widget:
    return Widget(
        id=wid,
        intent=intent,
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def _doc() -> SessionDocument:
    return SessionDocument(session_id="sid", image_bytes=b"", mime_type="image/jpeg")


def test_capture_then_apply_round_trip_canonical():
    doc = _doc()
    doc.set_param("layer-1", "basic", "exposure", 0.5)
    doc.set_param("layer-1", "basic", "contrast", 0.3)
    snap = Snapshot.capture(doc)

    # Mutate further...
    doc.set_param("layer-1", "basic", "exposure", 0.9)
    assert doc.canonical["layer-1"]["basic"]["exposure"] == 0.9

    # Apply rolls back to captured state.
    doc.apply_snapshot(snap)
    assert doc.canonical["layer-1"]["basic"]["exposure"] == 0.5
    assert doc.canonical["layer-1"]["basic"]["contrast"] == 0.3


def test_apply_restores_widgets_with_order():
    doc = _doc()
    doc.add_widget(_make_widget("w_a", intent="warm"))
    doc.add_widget(_make_widget("w_b", intent="cool"))
    snap = Snapshot.capture(doc)

    # Wipe the widget set after capture.
    doc.dismiss_widget("w_a")
    doc.dismiss_widget("w_b")
    assert doc.widgets["w_a"].status == "dismissed"

    doc.apply_snapshot(snap)
    assert doc.widget_order == ["w_a", "w_b"]
    assert doc.widgets["w_a"].status == "active"
    assert doc.widgets["w_b"].status == "active"


def test_apply_emits_history_applied_event_with_graph():
    doc = _doc()
    doc.set_param("layer-1", "basic", "exposure", 0.5)
    snap = Snapshot.capture(doc)
    doc.set_param("layer-1", "basic", "exposure", 0.9)

    rev_before = doc.revision
    ev = doc.apply_snapshot(snap)

    assert ev.kind == "history.applied"
    assert ev.revision == rev_before + 1
    # operationGraph reflects the restored canonical (exposure 0.5).
    graph_nodes = ev.payload["operationGraph"]["nodes"]
    assert any(
        n.get("params", {}).get("exposure") == 0.5 for n in graph_nodes
    ), f"expected exposure=0.5 in nodes, got {graph_nodes}"


def test_apply_does_not_mutate_the_snapshot():
    """Restoring twice from the same snapshot must yield identical state —
    apply_snapshot can't take a reference to snap's mutable dicts."""
    doc = _doc()
    doc.set_param("layer-1", "basic", "exposure", 0.5)
    snap = Snapshot.capture(doc)

    doc.apply_snapshot(snap)
    doc.set_param("layer-1", "basic", "exposure", 0.1)
    doc.apply_snapshot(snap)
    # Snapshot's canonical wasn't mutated by the first apply.
    assert snap.canonical["layer-1"]["basic"]["exposure"] == 0.5
    # Second apply restored the same value.
    assert doc.canonical["layer-1"]["basic"]["exposure"] == 0.5
