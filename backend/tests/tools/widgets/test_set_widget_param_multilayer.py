"""set_widget_param on a replicate widget (node carries layer_ids) writes the
new value into canonical for EVERY target layer, not just the anchor."""
import pytest

from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget,
    Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument
from app.tools.widgets.set_widget_param import SetWidgetParamTool


def _replicate_widget() -> Widget:
    scope = Scope.model_validate({"kind": "global"})
    return Widget(
        id="w_1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        op_id="basic", composed=False,
        nodes=[
            WidgetNode(
                id="n1", type="basic", params={"exposure": 0.0},
                scope=scope, inputs=[], widget_id="w_1",
                layer_id="L1", layer_ids=["L1", "L2"],
            ),
        ],
        bindings=[
            ControlBinding(
                param_key="exposure", label="Exposure", control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -2, "max": 2, "step": 0.1},
                ),
                value=0.0, default=0.0,
                target=NodeParamTarget(node_id="n1", param_key="exposure"),
            ),
        ],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )


@pytest.mark.asyncio
async def test_set_widget_param_writes_all_target_layers():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_replicate_widget())
    tool = SetWidgetParamTool()
    await tool.handler(
        doc,
        SetWidgetParamTool.input_schema.model_validate({
            "widgetId": "w_1", "paramKey": "exposure", "value": 0.7,
        }),
    )
    assert doc.canonical["L1"]["basic"]["exposure"] == 0.7
    assert doc.canonical["L2"]["basic"]["exposure"] == 0.7
