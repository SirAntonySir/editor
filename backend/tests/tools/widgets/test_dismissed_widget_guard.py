"""A dismissed widget is closed — mutating it must fail loudly, not silently
succeed. A stale client (frontend whose SSE diverged and still renders the
widget) otherwise keeps editing/accepting a ghost: the backend bumps node
params on a dismissed widget and canonical drifts (the session-87f7dd2e
zombie-widget forensics)."""
import pytest

from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget,
    Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument
from app.tools.widgets.accept_widget import AcceptWidgetTool
from app.tools.widgets.set_widget_param import SetWidgetParamTool


def _widget() -> Widget:
    scope = Scope.model_validate({"kind": "global"})
    return Widget(
        id="w_1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        op_id="basic", composed=False,
        nodes=[
            WidgetNode(
                id="n1", type="basic", params={"exposure": 0.0},
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
                target=NodeParamTarget(node_id="n1", param_key="exposure"),
            ),
        ],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )


def _dismissed_doc() -> SessionDocument:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget())
    doc.dismiss_widget("w_1")
    return doc


@pytest.mark.asyncio
async def test_set_widget_param_rejects_dismissed_widget():
    doc = _dismissed_doc()
    tool = SetWidgetParamTool()
    with pytest.raises(Exception, match="dismissed"):
        await tool.handler(doc, tool.input_schema.model_validate(
            {"widgetId": "w_1", "paramKey": "exposure", "value": 1.5},
        ))
    # Params untouched, canonical still clear (dismiss reset it).
    assert doc.widgets["w_1"].nodes[0].params["exposure"] == 0.0
    assert "basic" not in doc.canonical.get("L1", {})


@pytest.mark.asyncio
async def test_accept_widget_rejects_dismissed_widget():
    doc = _dismissed_doc()
    tool = AcceptWidgetTool()
    with pytest.raises(Exception, match="dismissed"):
        await tool.handler(doc, tool.input_schema.model_validate({"widgetId": "w_1"}))
    assert doc.widgets["w_1"].status == "dismissed"
