"""Tests for propose_stack: the toolrail fast path and preset_id path are
non-LLM and can be tested without mocking Anthropic. LLM paths are tested in
test_propose_stack_integration with mocked clients (Task 12).
"""
from __future__ import annotations

import pytest

from app.schemas.widget import Scope, WidgetOrigin
from app.state.document import SessionDocument
from app.tools.widgets.propose_stack import ProposeStackTool, _Input, _build_widget_multi, _dedup_plan


def test_dedup_within_widget_collapses_repeats():
    raw_plan = [
        {
            "widget_name": "HSL",
            "category": "color",
            "ops": [
                {"op_id": "hsl", "rationale": "warm reds", "starting_params": {"red_hue": 8}},
                {"op_id": "hsl", "rationale": "cooler greens", "starting_params": {"green_hue": -8}},
            ],
        },
    ]
    deduped = _dedup_plan(raw_plan)
    assert len(deduped) == 1
    ops = deduped[0]["ops"]
    assert len(ops) == 1
    assert ops[0]["starting_params"] == {"red_hue": 8, "green_hue": -8}
    assert "warm reds" in ops[0]["rationale"] and "cooler greens" in ops[0]["rationale"]


def test_dedup_cross_widget_merges_same_signature():
    raw_plan = [
        {
            "widget_name": "Lifted",
            "category": "tone",
            "ops": [{"op_id": "levels", "rationale": "lift", "starting_params": {"inBlack": 10}}],
        },
        {
            "widget_name": "Crushed",
            "category": "tone",
            "ops": [{"op_id": "levels", "rationale": "crush", "starting_params": {"inWhite": 240}}],
        },
    ]
    deduped = _dedup_plan(raw_plan)
    assert len(deduped) == 1
    # First widget wins on widget_name; params merge last-write-wins
    assert deduped[0]["widget_name"] == "Lifted"
    assert deduped[0]["ops"][0]["starting_params"] == {"inBlack": 10, "inWhite": 240}
    assert "lift" in deduped[0]["ops"][0]["rationale"]
    assert "crush" in deduped[0]["ops"][0]["rationale"]


def test_dedup_different_signatures_stay_separate():
    raw_plan = [
        {"widget_name": "A", "category": "tone",
         "ops": [{"op_id": "levels", "rationale": "x", "starting_params": {}}]},
        {"widget_name": "B", "category": "color",
         "ops": [{"op_id": "color", "rationale": "y", "starting_params": {}}]},
    ]
    deduped = _dedup_plan(raw_plan)
    assert len(deduped) == 2


def test_build_widget_multi_two_ops():
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt="test", parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name="Warm fade",
        category="color",
        ops=[
            ("color",     {"saturation": -15}),
            ("splitTone", {"shadow_hue": 200, "shadow_sat": 30}),
        ],
        intent="vintage",
        scope=scope, origin=origin,
        layer_id="legacy",
        image_node_layer_ids=None,
    )
    # One widget with two nodes
    assert widget.display_name == "Warm fade"
    assert widget.category == "color"
    assert len(widget.nodes) == 2
    # Nodes carry their op-specific types
    node_types = {n.type for n in widget.nodes}
    assert node_types == {"basic", "splitTone"}    # `color` op's engine.node_type is "basic"
    # Bindings concatenated (count == sum of params on each op)
    assert len(widget.bindings) == len(widget.nodes[0].params) + len(widget.nodes[1].params)
    # widget.op_id is the FIRST op's id
    assert widget.op_id == "color"


def test_build_widget_multi_single_op_equivalence():
    """The single-op wrapper produces a widget identical to today's _build_widget."""
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name=None, category=None,
        ops=[("grain", {"amount": 18})],
        intent="grain", scope=scope, origin=origin,
        layer_id="legacy", image_node_layer_ids=None,
    )
    assert widget.display_name is None
    assert widget.category is None
    assert len(widget.nodes) == 1
    assert widget.nodes[0].type == "grain"
    assert widget.op_id == "grain"


def test_build_widget_multi_bindings_target_correct_nodes():
    """A binding from the 2nd op must target the 2nd node, not the 1st."""
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt="t", parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name="Mixed", category=None,
        ops=[
            ("color",     {"saturation": 0}),
            ("splitTone", {}),
        ],
        intent="t", scope=scope, origin=origin,
        layer_id="legacy", image_node_layer_ids=None,
    )
    color_node_id = widget.nodes[0].id
    split_node_id = widget.nodes[1].id
    for b in widget.bindings:
        # color params target node 0; splitTone params target node 1
        if b.param_key in ("saturation", "vibrance", "hue"):
            assert b.target.node_id == color_node_id, f"{b.param_key} should target color node"
        else:
            assert b.target.node_id == split_node_id, f"{b.param_key} should target splitTone node"


@pytest.mark.asyncio
async def test_toolrail_single_op_spawns_one_widget(make_doc):
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="grain",
        scope={"kind": "global"},
        origin="tool_invoked",
        forced_ops=["grain"],
    ))
    assert len(out.widgets) == 1
    assert out.widgets[0]["nodes"][0]["type"] == "grain"


@pytest.mark.asyncio
async def test_toolrail_multi_op_spawns_multiple(make_doc):
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="vintage",
        scope={"kind": "global"},
        origin="tool_invoked",
        forced_ops=["grain", "vignette"],
    ))
    assert len(out.widgets) == 2


@pytest.mark.asyncio
async def test_preset_id_unfolds_into_widgets(make_doc):
    """preset_id='vintage' must unfold its ops (>=2) without an LLM call."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="vintage",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
        preset_id="vintage",
    ))
    # vintage preset has 3 ops (levels, color, hsl)
    assert len(out.widgets) >= 2
    op_ids = {w["op_id"] for w in out.widgets}
    assert "levels" in op_ids


@pytest.mark.asyncio
async def test_preset_id_tone_red_spawns_single_band_hsl(make_doc):
    """tone_red preset spawns one hsl widget with only red params."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="HSL red",
        scope={"kind": "global"},
        origin="tool_invoked",
        preset_id="tone_red",
    ))
    assert len(out.widgets) == 1
    w = out.widgets[0]
    assert w["op_id"] == "hsl"
    binding_keys = {b["param_key"] for b in w["bindings"]}
    assert binding_keys == {"red_hue", "red_sat", "red_lum"}


@pytest.mark.asyncio
async def test_preset_id_unknown_raises(make_doc):
    """Unknown preset_id must raise a ValueError."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    with pytest.raises(ValueError, match="unknown preset id"):
        await tool.handler(doc, _Input(
            intent="test",
            scope={"kind": "global"},
            origin="mcp_user_prompt",
            preset_id="nonexistent_preset_xyz",
        ))


@pytest.mark.asyncio
async def test_preset_id_image_node_stamps_layer_ids(make_doc):
    """preset_id path with image_node scope stamps layer_ids on every node."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="HSL blue",
        scope={
            "kind": "image_node",
            "image_node_id": "in-1",
            "layer_ids": ["l-1", "l-2"],
        },
        origin="tool_invoked",
        preset_id="tone_blue",
    ))
    assert len(out.widgets) == 1
    for node in out.widgets[0]["nodes"]:
        assert node["layer_ids"] == ["l-1", "l-2"]
        assert node["layer_id"] == "l-1"
