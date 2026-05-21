import pytest

from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    DismissalRule,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetOrigin,
    WidgetPreview,
)
from app.state.document import SessionDocument


def _make_widget(wid: str = "w_1", intent: str = "warm subject") -> Widget:
    return Widget(
        id=wid,
        intent=intent,
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt=intent),
        fused_tool_id="warm_grade",
        nodes=[],
        bindings=[],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        status="active",
        revision=1,
    )


def test_new_document_has_revision_zero_and_no_widgets() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    assert doc.revision == 0
    assert doc.widgets == {}


def test_add_widget_bumps_revision_and_emits_created() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    events = doc.add_widget(_make_widget("w_1"))
    assert doc.revision == 1
    assert "w_1" in doc.widgets
    assert doc.widget_order == ["w_1"]
    assert len(events) == 1
    assert events[0].kind == "widget.created"
    assert events[0].revision == 1


def test_update_widget_bumps_revision_keeps_order() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    doc.add_widget(_make_widget("w_1"))
    doc.add_widget(_make_widget("w_2"))
    updated = _make_widget("w_1", intent="warm subject")
    updated.revision = 2
    updated.reasoning = "now reasoned"
    events = doc.update_widget(updated)
    assert doc.revision == 3
    assert doc.widgets["w_1"].reasoning == "now reasoned"
    assert doc.widget_order == ["w_1", "w_2"]
    assert events[0].kind == "widget.updated"


def test_dismiss_widget_soft_deletes_and_appends_rule() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    doc.add_widget(_make_widget("w_1", intent="warm subject"))
    rule = DismissalRule(
        id="d_1", source_widget_id="w_1",
        intent_norm="warm subject", scope_signature="global",
        fused_tool_id="warm_grade",
    )
    events = doc.dismiss_widget("w_1", rule=rule)
    assert doc.widgets["w_1"].status == "dismissed"
    assert doc.dismissals == [rule]
    kinds = {e.kind for e in events}
    assert kinds == {"widget.deleted", "dismissal.added"}


def test_restore_widget_clears_rule_and_status() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    doc.add_widget(_make_widget("w_1"))
    rule = DismissalRule(
        id="d_1", source_widget_id="w_1",
        intent_norm="warm", scope_signature="global", fused_tool_id="warm_grade",
    )
    doc.dismiss_widget("w_1", rule=rule)
    events = doc.restore_widget("w_1")
    assert doc.widgets["w_1"].status == "active"
    assert doc.dismissals == []
    assert events[0].kind == "widget.restored"


def test_unknown_widget_id_raises_key_error() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    with pytest.raises(KeyError):
        doc.update_widget(_make_widget("missing"))
