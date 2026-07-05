"""update_widget_targets mutates a widget's node.layer_ids target set and
reseeds canonical accordingly — the backend half of connect / reconnect /
delete on the workspace canvas."""
import pytest

from app.schemas.widget import (
    Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument
from app.tools.widgets.update_widget_targets import UpdateWidgetTargetsTool


def _single_target_widget() -> Widget:
    scope = Scope.model_validate({"kind": "global"})
    return Widget(
        id="w1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None),
        op_id="basic", composed=False,
        nodes=[WidgetNode(
            id="n1", type="basic", params={"exposure": 0.4},
            scope=scope, inputs=[], widget_id="w1", layer_id="L1",
        )],
        bindings=[],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        status="active", revision=1,
    )


def _doc() -> SessionDocument:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_single_target_widget())
    return doc


async def _run(doc, payload):
    await UpdateWidgetTargetsTool().handler(
        doc, UpdateWidgetTargetsTool.input_schema.model_validate(payload)
    )


@pytest.mark.asyncio
async def test_add_target_extends_layer_ids_and_seeds_canonical():
    doc = _doc()
    await _run(doc, {"widgetId": "w1", "op": "add", "layerId": "L2"})
    assert doc.widgets["w1"].nodes[0].layer_ids == ["L1", "L2"]
    assert doc.canonical["L1"]["basic"]["exposure"] == 0.4
    assert doc.canonical["L2"]["basic"]["exposure"] == 0.4


@pytest.mark.asyncio
async def test_remove_last_target_empties_layer_ids_and_clears_canonical():
    doc = _doc()
    await _run(doc, {"widgetId": "w1", "op": "remove", "layerId": "L1"})
    assert doc.widgets["w1"].nodes[0].layer_ids == []
    assert "basic" not in doc.canonical.get("L1", {})


@pytest.mark.asyncio
async def test_retarget_swaps_layer_and_moves_canonical():
    doc = _doc()
    await _run(doc, {"widgetId": "w1", "op": "retarget",
                     "layerId": "L2", "fromLayerId": "L1"})
    assert doc.widgets["w1"].nodes[0].layer_ids == ["L2"]
    assert "basic" not in doc.canonical.get("L1", {})
    assert doc.canonical["L2"]["basic"]["exposure"] == 0.4
