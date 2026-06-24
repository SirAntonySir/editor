"""_compute_affected_widget_ids — which widgets a mutation touched, derived
from the tool input plus a before/after snapshot diff."""

from __future__ import annotations

from types import SimpleNamespace

from app.schemas.widget import Scope, Widget, WidgetNode, WidgetOrigin
from app.session.history import Snapshot
from app.state.document import SessionDocument
from app.tools.registry import _compute_affected_widget_ids


def _doc() -> SessionDocument:
    return SessionDocument(session_id="s1", image_bytes=b"\xff\xd8\xff", mime_type="image/jpeg")


def _widget(wid: str, nid: str, params: dict) -> Widget:
    g = Scope.model_validate({"kind": "global"})
    return Widget(
        id=wid, intent="x", scope=g,
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"), op_id="basic",
        nodes=[WidgetNode(id=nid, type="basic", scope=g, widget_id=wid,
                          layer_id="layer-1", params=params)],
        bindings=[],
    )


def test_uses_widget_id_from_tool_input():
    doc = _doc()
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    before = Snapshot.capture(doc)
    after = Snapshot.capture(doc)
    parsed = SimpleNamespace(widget_id="w1", param_key="exposure", value=0.3)
    assert _compute_affected_widget_ids(before, after, parsed) == ["w1"]


def test_diffs_changed_widget_params_without_widget_id_on_input():
    doc = _doc()
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    before = Snapshot.capture(doc)
    # Mutate the widget's node params, then capture after.
    doc.widgets["w1"].nodes[0].params["exposure"] = 0.1
    after = Snapshot.capture(doc)
    parsed = SimpleNamespace(layer_id="layer-1", op="basic")  # no widget_id
    assert _compute_affected_widget_ids(before, after, parsed) == ["w1"]


def test_detects_newly_created_widget():
    doc = _doc()
    before = Snapshot.capture(doc)
    doc.add_widget(_widget("w2", "n2", {"contrast": 0.4}))
    after = Snapshot.capture(doc)
    parsed = SimpleNamespace()
    assert _compute_affected_widget_ids(before, after, parsed) == ["w2"]


def test_no_change_returns_empty():
    doc = _doc()
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    before = Snapshot.capture(doc)
    after = Snapshot.capture(doc)
    parsed = SimpleNamespace()
    assert _compute_affected_widget_ids(before, after, parsed) == []
