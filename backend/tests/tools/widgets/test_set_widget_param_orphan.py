"""C10 regression: set_widget_param raises orphan_binding when the
binding's target node is missing from the widget. Without the fix the
binding.value update would land but the canonical write would silently
skip, leaving widget vs. op_graph drift."""

import pytest

from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget,
    Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument, _deep_copy
from app.tools.widgets.set_widget_param import (
    SetWidgetParamTool, _OrphanBinding,
)


def _widget_with_orphan_binding() -> Widget:
    """Build a widget whose only binding references a node id NOT in
    `widget.nodes`. Simulates the post-cleanup-by-other-tool state."""
    scope = Scope.model_validate({"kind": "global"})
    return Widget(
        id="w_1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        op_id="basic", composed=False,
        nodes=[
            WidgetNode(
                id="n_present", type="basic", params={"exposure": 0.0},
                scope=scope, inputs=[], widget_id="w_1",
            ),
        ],
        bindings=[
            ControlBinding(
                param_key="exposure", label="Exposure", control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -2, "max": 2, "step": 0.1},
                ),
                value=0.0, default=0.0,
                # Targets a node id that doesn't exist on the widget.
                target=NodeParamTarget(node_id="n_ghost", param_key="exposure"),
            ),
        ],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )


@pytest.mark.asyncio
async def test_set_widget_param_raises_orphan_binding_when_node_missing():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget_with_orphan_binding())
    tool = SetWidgetParamTool()
    with pytest.raises(_OrphanBinding, match="n_ghost"):
        await tool.handler(
            doc,
            SetWidgetParamTool.input_schema.model_validate({
                "widgetId": "w_1", "paramKey": "exposure", "value": 1.5,
            }),
        )


@pytest.mark.asyncio
async def test_set_widget_param_does_not_mutate_state_on_orphan():
    """Critical invariant: the orphan path raises BEFORE mutating
    `binding.value`. After the failure, the widget's bindings are
    untouched and canonical is not updated by the failed call."""
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget_with_orphan_binding())
    # Capture canonical state after widget addition (seeded by add_widget).
    canonical_before = _deep_copy(doc.canonical)
    tool = SetWidgetParamTool()
    try:
        await tool.handler(
            doc,
            SetWidgetParamTool.input_schema.model_validate({
                "widgetId": "w_1", "paramKey": "exposure", "value": 1.5,
            }),
        )
    except _OrphanBinding:
        pass
    w = doc.widgets["w_1"]
    assert w.bindings[0].value == 0.0  # original value preserved
    # Canonical is unchanged by the failed call.
    assert doc.canonical == canonical_before


@pytest.mark.asyncio
async def test_set_widget_param_normal_path_still_works():
    """Sanity: a binding that DOES point at an existing node mutates
    binding.value, node.params, AND canonical, as before."""
    scope = Scope.model_validate({"kind": "global"})
    doc = SessionDocument(session_id="s1")
    w = Widget(
        id="w_1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        op_id="basic", composed=False,
        nodes=[
            WidgetNode(
                id="n_1", type="basic", params={"exposure": 0.0},
                scope=scope, inputs=[], widget_id="w_1", layer_id="L1",
            ),
        ],
        bindings=[
            ControlBinding(
                param_key="exposure", label="Exposure", control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -2, "max": 2, "step": 0.1},
                ),
                value=0.0, default=0.0,
                target=NodeParamTarget(node_id="n_1", param_key="exposure"),
            ),
        ],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )
    doc.add_widget(w)
    tool = SetWidgetParamTool()
    out = await tool.handler(
        doc,
        SetWidgetParamTool.input_schema.model_validate({
            "widgetId": "w_1", "paramKey": "exposure", "value": 1.5,
        }),
    )
    assert out.ok is True
    w_after = doc.widgets["w_1"]
    assert w_after.bindings[0].value == 1.5
    assert w_after.nodes[0].params["exposure"] == 1.5
    # Canonical was set via doc.set_param.
    assert doc.canonical["L1"]["basic"]["exposure"] == 1.5
