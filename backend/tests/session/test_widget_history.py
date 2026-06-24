"""Per-widget history: entry tagging, param-snapshot extraction, and the
widget-scoped timeline projection over the global undo stack."""

from __future__ import annotations

from app.schemas.widget import Scope, Widget, WidgetNode, WidgetOrigin
from app.session.history import HistoryEngine, Snapshot
from app.state.document import SessionDocument


def _doc() -> SessionDocument:
    return SessionDocument(session_id="s1", image_bytes=b"\xff\xd8\xff", mime_type="image/jpeg")


def _widget(wid: str, nid: str, params: dict) -> Widget:
    g = Scope.model_validate({"kind": "global"})
    return Widget(
        id=wid,
        intent="x",
        scope=g,
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"),
        op_id="basic",
        nodes=[WidgetNode(id=nid, type="basic", scope=g, widget_id=wid,
                          layer_id="layer-1", params=params)],
        bindings=[],
    )


# ---------------- Snapshot.extract_widget_params ----------------


def test_extract_widget_params_returns_node_param_map():
    doc = _doc()
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    snap = Snapshot.capture(doc)
    assert snap.extract_widget_params(["w1"]) == {"w1": {"n1": {"exposure": 0.5}}}


def test_extract_widget_params_skips_unknown_widget():
    doc = _doc()
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    snap = Snapshot.capture(doc)
    assert snap.extract_widget_params(["nope"]) == {}


# ---------------- HistoryEntry tagging ----------------


def _snap(label: str) -> Snapshot:
    return Snapshot(canonical={"_label": label})


def test_push_records_affected_widget_ids_and_params():
    eng = HistoryEngine(max_entries=5)
    entry = eng.push(
        "set exposure",
        _snap("before"),
        _snap("after"),
        affected_widget_ids=["w1"],
        widget_params_before={"w1": {"n1": {"exposure": 0.5}}},
        widget_params_after={"w1": {"n1": {"exposure": 0.3}}},
    )
    assert entry.affected_widget_ids == ["w1"]
    assert entry.widget_params_before == {"w1": {"n1": {"exposure": 0.5}}}
    assert entry.widget_params_after == {"w1": {"n1": {"exposure": 0.3}}}


def test_push_defaults_to_empty_tagging():
    eng = HistoryEngine(max_entries=5)
    entry = eng.push("x", _snap("b"), _snap("a"))
    assert entry.affected_widget_ids == []
    assert entry.widget_params_before == {}
    assert entry.widget_params_after == {}


def test_coalesce_carries_latest_after_params():
    eng = HistoryEngine(max_entries=5)
    eng.push("set", _snap("b"), _snap("a1"),
             affected_widget_ids=["w1"],
             widget_params_after={"w1": {"n1": {"exposure": 0.3}}},
             coalesce_key="k", coalesce_window_s=10.0)
    eng.push("set", _snap("b"), _snap("a2"),
             affected_widget_ids=["w1"],
             widget_params_after={"w1": {"n1": {"exposure": 0.1}}},
             coalesce_key="k", coalesce_window_s=10.0)
    assert len(eng.entries) == 1
    assert eng.entries[0].widget_params_after == {"w1": {"n1": {"exposure": 0.1}}}


# ---------------- HistoryEngine.widget_timeline ----------------


def test_widget_timeline_filters_to_widget():
    eng = HistoryEngine(max_entries=10)
    e1 = eng.push("w1 edit", _snap("b"), _snap("a"), affected_widget_ids=["w1"])
    eng.push("w2 edit", _snap("b"), _snap("a"), affected_widget_ids=["w2"])
    e3 = eng.push("w1 edit again", _snap("b"), _snap("a"), affected_widget_ids=["w1"])

    entries = eng.widget_timeline("w1")
    assert [e.id for e in entries] == [e1.id, e3.id]


def test_widget_timeline_excludes_restore_entries():
    eng = HistoryEngine(max_entries=10)
    e1 = eng.push("w1 edit", _snap("b"), _snap("a"), affected_widget_ids=["w1"])
    # A restore-generated entry touches the widget too, but must not appear as
    # a step in the per-widget timeline (it would inflate the count + clutter).
    eng.push("Restored to earlier state", _snap("b"), _snap("a"),
             affected_widget_ids=["w1"], is_restore=True)
    entries = eng.widget_timeline("w1")
    assert [e.id for e in entries] == [e1.id]


def test_push_marks_restore_entries():
    eng = HistoryEngine(max_entries=5)
    entry = eng.push("Restored", _snap("b"), _snap("a"),
                     affected_widget_ids=["w1"], is_restore=True)
    assert entry.is_restore is True


def test_push_defaults_is_restore_false():
    eng = HistoryEngine(max_entries=5)
    entry = eng.push("set", _snap("b"), _snap("a"))
    assert entry.is_restore is False
