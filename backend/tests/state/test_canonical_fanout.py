"""A widget whose node carries layer_ids (multi-target replicate) must seed
canonical for EVERY target layer, and reset must clear them all again."""
from app.schemas.widget import (
    Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument


def _replicate_widget(wid: str, layer_ids: list[str], op: str, params: dict) -> Widget:
    return Widget(
        id=wid, intent="x", scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="tool_invoked", prompt=None),
        op_id="warm_grade",
        nodes=[WidgetNode(
            id=f"n_{wid}", type=op, params=params,
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id=wid,
            layer_id=layer_ids[0], layer_ids=layer_ids,
        )],
        bindings=[],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        status="active", revision=1,
    )


def test_seed_fans_out_over_all_target_layers():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_replicate_widget("w1", ["L1", "L2"], "basic", {"exposure": 0.4}))
    assert doc.canonical["L1"]["basic"]["exposure"] == 0.4
    assert doc.canonical["L2"]["basic"]["exposure"] == 0.4


def test_reset_clears_all_target_layers():
    doc = SessionDocument(session_id="s1")
    w = _replicate_widget("w1", ["L1", "L2"], "basic", {"exposure": 0.4})
    doc.add_widget(w)
    doc._reset_canonical_from_widget(w)
    assert "basic" not in doc.canonical.get("L1", {})
    assert "basic" not in doc.canonical.get("L2", {})
