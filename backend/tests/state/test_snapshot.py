from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.state.document import SessionDocument
from app.state.snapshot import SessionStateSnapshot, compute_snapshot


def _widget(wid: str) -> Widget:
    return Widget(
        id=wid, intent=f"i-{wid}",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"),
        fused_tool_id="warm_grade",
        nodes=[WidgetNode(
            id=f"n_{wid}", type="kelvin", params={"temperature": 6500},
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id=wid,
        )],
        bindings=[ControlBinding(
            param_key="temperature", label="T", control_type="slider",
            target=NodeParamTarget(node_id=f"n_{wid}", param_key="temperature"),
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": 3000, "max": 9000, "step": 50}
            ),
            value=6500, default=5500,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def test_snapshot_carries_widgets_and_projection() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1"))
    snap = compute_snapshot(doc)
    assert isinstance(snap, SessionStateSnapshot)
    assert snap.session_id == "s1"
    assert len(snap.widgets) == 1
    assert len(snap.operation_graph.nodes) == 1
    assert snap.revision == doc.revision


def test_snapshot_masks_index_summarises() -> None:
    from app.schemas.widget import MaskRecord
    doc = SessionDocument(session_id="s1")
    doc.masks["m_1"] = MaskRecord(
        id="m_1", width=10, height=10, png_b64="aGVsbG8=",
        source="sam_point", label=None,
    )
    snap = compute_snapshot(doc)
    assert any(m["id"] == "m_1" for m in snap.masks_index)
