"""propose_stack handles the `filter` op_id without touching the registry.

The widget shape is identical to what TOOL_DEFAULTS['filter'] used to
produce via the legacy propose_widget path: one lut node, one intensity
slider binding, scope passed through, origin tool_invoked."""

import pytest

from app.schemas.widget import Scope
from app.state.document import SessionDocument
from app.tools.widgets.propose_stack import ProposeStackTool


@pytest.mark.asyncio
async def test_propose_stack_filter_spawns_lut_widget_with_intensity_binding():
    doc = SessionDocument(session_id="s1")
    tool = ProposeStackTool()
    scope = Scope.model_validate({"kind": "global"})
    out = await tool.handler(
        doc,
        ProposeStackTool.input_schema.model_validate({
            "intent": "Apply Vintage filter",
            "scope": {"kind": "global"},
            "origin": "tool_invoked",
            "forcedOps": ["filter"],
            "layerId": "L1",
        }),
    )
    assert len(out.widgets) == 1
    w = out.widgets[0]
    assert w["opId"] == "filter"
    assert w["origin"]["kind"] == "tool_invoked"
    assert w["scope"] == scope.model_dump(mode="json", by_alias=True)
    # One lut node with intensity=1.0
    assert len(w["nodes"]) == 1
    node = w["nodes"][0]
    assert node["type"] == "lut"
    assert node["params"] == {"intensity": 1.0}
    # One intensity slider binding
    assert len(w["bindings"]) == 1
    b = w["bindings"][0]
    assert b["paramKey"] == "intensity"
    assert b["label"] == "Intensity"
    assert b["controlType"] == "slider"
    assert b["value"] == 1.0
    assert b["default"] == 1.0
    # Binding targets the node we just built.
    assert b["target"]["nodeId"] == node["id"]
    assert b["target"]["paramKey"] == "intensity"


@pytest.mark.asyncio
async def test_propose_stack_filter_with_image_node_scope_propagates_layer_ids():
    """When scope.kind == 'image_node', the node carries layer_ids and the
    legacy single layer_id is the first entry — mirrors what propose_widget
    used to do."""
    doc = SessionDocument(session_id="s1")
    tool = ProposeStackTool()
    out = await tool.handler(
        doc,
        ProposeStackTool.input_schema.model_validate({
            "intent": "Apply Vintage filter",
            "scope": {"kind": "image_node", "imageNodeId": "in-1", "layerIds": ["L1", "L2"]},
            "origin": "tool_invoked",
            "forcedOps": ["filter"],
            "layerId": "ignored",
        }),
    )
    w = out.widgets[0]
    assert w["nodes"][0]["layerId"] == "L1"
    assert w["nodes"][0]["layerIds"] == ["L1", "L2"]


@pytest.mark.asyncio
async def test_propose_stack_filter_combined_with_registry_op_is_rejected():
    """Mixed forced_ops (filter + a registry op in the same call) is not
    supported — the filter path is single-op only."""
    doc = SessionDocument(session_id="s1")
    tool = ProposeStackTool()
    with pytest.raises(ValueError, match="filter"):
        await tool.handler(
            doc,
            ProposeStackTool.input_schema.model_validate({
                "intent": "irrelevant",
                "scope": {"kind": "global"},
                "origin": "tool_invoked",
                "forcedOps": ["filter", "basic"],
                "layerId": "L1",
            }),
        )
