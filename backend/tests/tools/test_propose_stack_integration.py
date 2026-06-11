"""End-to-end: 'make it look like a vintage film' must spawn ≥3 widgets."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.registry.loader import get_registry, reload_registry
from app.tools.widgets.propose_stack import ProposeStackTool, _Input


@pytest.mark.asyncio
async def test_vintage_intent_spawns_multi_widget_stack(make_doc, monkeypatch):
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    # Fake planner returns 5-op stack.
    fake_plan = {
        "plan": [
            {"op_id": "levels",     "rationale": "lifted blacks"},
            {"op_id": "color",      "rationale": "slight desat"},
            {"op_id": "hsl",        "rationale": "warm shift"},
            {"op_id": "splitTone",  "rationale": "teal/orange"},
            {"op_id": "grain",      "rationale": "fine film grain"},
        ],
        "overall_rationale": "vintage film recipe",
    }

    # Fake resolver returns sensible per-op params (all defaults).
    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac

    monkeypatch.setattr(
        ac.AnthropicClient,
        "plan_widget_stack",
        MagicMock(return_value=fake_plan),
    )
    monkeypatch.setattr(
        ac.AnthropicClient,
        "resolve_widget_params",
        MagicMock(side_effect=fake_resolve),
    )
    # Ensure deps.get_anthropic_client returns a real-looking instance.
    monkeypatch.setattr(
        "app.api.deps.get_anthropic_client",
        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"),
    )

    out = await tool.handler(doc, _Input(
        intent="make it look like a vintage film",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    assert len(out.widgets) == 5
    op_ids = {w["opId"] for w in out.widgets}
    assert {"levels", "color", "hsl", "splitTone", "grain"} == op_ids


@pytest.mark.asyncio
async def test_planner_empty_falls_back_to_keyword_preset(make_doc, monkeypatch):
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    from app.services import anthropic_client as ac

    monkeypatch.setattr(
        ac.AnthropicClient,
        "plan_widget_stack",
        MagicMock(return_value={"plan": []}),
    )
    monkeypatch.setattr(
        ac.AnthropicClient,
        "resolve_widget_params",
        MagicMock(side_effect=lambda *, op, **_: {
            k: p.default for k, p in op.params.items()
        }),
    )
    monkeypatch.setattr(
        "app.api.deps.get_anthropic_client",
        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"),
    )

    reg = reload_registry()
    assert "vintage" in reg.presets   # presets must be loaded

    out = await tool.handler(doc, _Input(
        intent="make it vintage",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    # Fallback used → at least one widget from the vintage preset
    assert len(out.widgets) >= 1


@pytest.mark.asyncio
async def test_vintage_produces_multi_op_widget(make_doc, monkeypatch):
    """The vintage prompt should produce a multi-op widget (color + splitTone)
    plus single-op widgets for the rest."""
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    fake_plan = {
        "plan": [
            {"widget_name": "Lifted blacks", "category": "tone",
             "ops": [{"op_id": "levels", "rationale": "lift", "starting_params": {}}]},
            {"widget_name": "Warm fade", "category": "color",
             "ops": [
                 {"op_id": "color",     "rationale": "desat", "starting_params": {}},
                 {"op_id": "splitTone", "rationale": "teal/orange", "starting_params": {}},
             ]},
            {"widget_name": "Film grain", "category": "texture",
             "ops": [{"op_id": "grain", "rationale": "fine", "starting_params": {}}]},
        ],
        "overall_rationale": "vintage film",
    }

    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac
    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(return_value=fake_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=fake_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await tool.handler(doc, _Input(
        intent="make it look like a vintage film",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    # 3 widgets
    assert len(out.widgets) == 3
    # Each has a display_name
    names = [w["displayName"] for w in out.widgets]
    assert "Lifted blacks" in names
    assert "Warm fade" in names
    assert "Film grain" in names
    # The "Warm fade" widget has 2 nodes (color + splitTone)
    warm_fade = next(w for w in out.widgets if w["displayName"] == "Warm fade")
    assert len(warm_fade["nodes"]) == 2
    node_types = {n["type"] for n in warm_fade["nodes"]}
    assert node_types == {"basic", "splitTone"}    # color → basic, splitTone → splitTone
    # Categories propagate
    assert warm_fade["category"] == "color"


@pytest.mark.asyncio
async def test_old_shape_plan_response_back_compat(make_doc, monkeypatch):
    """A planner returning the OLD flat shape still produces single-op widgets."""
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    fake_plan = {
        "plan": [
            {"op_id": "levels", "rationale": "lift"},
            {"op_id": "grain",  "rationale": "fine"},
        ],
        "overall_rationale": "back-compat shape",
    }

    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac
    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(return_value=fake_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=fake_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await tool.handler(doc, _Input(
        intent="t", scope={"kind": "global"}, origin="mcp_user_prompt",
    ))
    assert len(out.widgets) == 2
    # display_name is None when planner doesn't provide one
    assert all(w["displayName"] is None for w in out.widgets)
    assert all(len(w["nodes"]) == 1 for w in out.widgets)
