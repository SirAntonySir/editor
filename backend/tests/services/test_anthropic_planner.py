"""Planner method tests use a faked anthropic SDK call.

plan_widget_stack uses forced tool use (emit_plan) — fakes must return a
tool_use block, not free text.
"""
from unittest.mock import MagicMock

import pytest

from app.registry.loader import reload_registry
from app.services.anthropic_client import AnthropicClient


def _tool_response(tool_name: str, payload: dict) -> MagicMock:
    block = MagicMock()
    block.type = "tool_use"
    # `name` is a MagicMock constructor kwarg, so it must be set as an attribute.
    block.name = tool_name
    block.input = payload
    resp = MagicMock()
    resp.content = [block]
    return resp


def test_plan_widget_stack_returns_op_plan(monkeypatch):
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    fake_response = _tool_response("emit_plan", {
        "plan": [
            {"op_id": "levels", "rationale": "lift blacks for film"},
            {"op_id": "splitTone", "rationale": "warm/cool tone"},
            {"op_id": "grain", "rationale": "film texture"},
        ],
        "overall_rationale": "vintage film recipe",
    })
    monkeypatch.setattr(client._client.messages, "create",
                        MagicMock(return_value=fake_response))

    reg = reload_registry()  # ensure presets are loaded
    result = client.plan_widget_stack(
        intent="vintage film",
        scope={"kind": "global"},
        image_context={"palette": "warm"},
        existing_widgets=[],
        registry=reg,
        session_id="s1",
    )
    assert [op["op_id"] for op in result["plan"]] == ["levels", "splitTone", "grain"]


def test_plan_widget_stack_nested_shape(monkeypatch):
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    fake = _tool_response("emit_plan", {
        "plan": [
            {"widget_name": "Lifted blacks", "category": "tone",
             "ops": [{"op_id": "levels", "rationale": "raise inBlack",
                      "starting_params": {"inBlack": 12}}]},
            {"widget_name": "Warm fade", "category": "color",
             "ops": [
                 {"op_id": "color", "rationale": "desat -15",
                  "starting_params": {"saturation": -15}},
                 {"op_id": "splitTone", "rationale": "teal/orange",
                  "starting_params": None},
             ]},
        ],
        "overall_rationale": "vintage film",
    })
    monkeypatch.setattr(client._client.messages, "create",
                        MagicMock(return_value=fake))

    reg = reload_registry()
    result = client.plan_widget_stack(
        intent="vintage film",
        scope={"kind": "global"},
        image_context={"palette": "warm"},
        existing_widgets=[],
        registry=reg,
        session_id="s1",
    )
    plan = result["plan"]
    assert len(plan) == 2
    assert plan[0]["widget_name"] == "Lifted blacks"
    assert plan[0]["category"] == "tone"
    assert len(plan[1]["ops"]) == 2
    assert plan[1]["ops"][0]["op_id"] == "color"


def test_plan_widget_stack_retries_then_raises_without_tool_block(monkeypatch):
    """A response with no emit_plan tool_use block is retried once, then the
    call raises so propose_stack can journal planner_failed + fall back."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    text_only = MagicMock()
    text_only.content = [MagicMock(text="```json\n{\"plan\": []}\n```")]
    spy = MagicMock(return_value=text_only)
    monkeypatch.setattr(client._client.messages, "create", spy)

    reg = reload_registry()
    with pytest.raises(RuntimeError, match="emit_plan"):
        client.plan_widget_stack(
            intent="vintage film", scope={"kind": "global"},
            image_context={}, existing_widgets=[], registry=reg,
            session_id=None,
        )
    assert spy.call_count == 2  # initial + 1 retry


def test_plan_widget_stack_retry_recovers(monkeypatch):
    """First attempt lacks the tool block, second succeeds — the plan lands."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    bad = MagicMock()
    bad.content = [MagicMock(text="not a tool call")]
    good = _tool_response("emit_plan", {
        "plan": [{"op_id": "grain", "rationale": "fine"}],
        "overall_rationale": "r",
    })
    monkeypatch.setattr(client._client.messages, "create",
                        MagicMock(side_effect=[bad, good]))

    reg = reload_registry()
    result = client.plan_widget_stack(
        intent="grainy", scope={"kind": "global"},
        image_context={}, existing_widgets=[], registry=reg,
        session_id=None,
    )
    assert result["plan"][0]["op_id"] == "grain"


def test_plan_widget_stack_catalog_surfaces_compound_dial(monkeypatch):
    """The ops catalog sent to the planner must include `compound_dial` info
    for compound ops so the model knows time-of-day is a 1D dial, not a
    manual stack of N tone+color sliders."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")

    captured: dict = {}

    def fake_create(**kwargs):
        captured["messages"] = kwargs.get("messages")
        captured["system"] = kwargs.get("system")
        captured["tools"] = kwargs.get("tools")
        captured["tool_choice"] = kwargs.get("tool_choice")
        return _tool_response("emit_plan", {"plan": []})

    monkeypatch.setattr(client._client.messages, "create", fake_create)

    reg = reload_registry()
    client.plan_widget_stack(
        intent="make it a night scene",
        scope={"kind": "global"},
        image_context={},
        existing_widgets=[],
        registry=reg,
        session_id="s1",
    )

    # Forced tool use — one markdown fence must never empty the plan again.
    assert captured["tool_choice"] == {"type": "tool", "name": "emit_plan"}

    catalog_blob = captured["messages"][0]["content"][0]["text"]
    # The TOD op's compound_dial info must be visible to the LLM.
    assert "time-of-day" in catalog_blob
    assert "compound_dial" in catalog_blob
    assert "time_of_day.position" in catalog_blob
    # All 5 compound dials' anchor names should appear in the catalog.
    expected_anchor_names = (
        # time-of-day
        "dawn", "noon", "golden", "blue", "night",
        # weather
        "sunny", "partly_cloudy", "overcast", "fog", "rain",
        # mood
        "serene", "calm", "dramatic", "aggressive",
        # season
        "spring", "summer", "autumn", "winter",
        # age
        "fresh", "retro", "vintage", "antique",
    )
    for name in expected_anchor_names:
        assert name in catalog_blob, f"missing anchor name in catalog: {name}"
    # All 5 compound op ids should appear too.
    for op_id in ("time-of-day", "weather", "mood", "season", "age"):
        assert op_id in catalog_blob, f"missing compound op_id in catalog: {op_id}"

    # The system prompt should instruct the model how to use compound dials.
    system_blob = str(captured["system"])
    assert "COMPOUND DIAL OPS" in system_blob
    assert "compound_dial" in system_blob


def test_planner_prompt_lists_mood_category(monkeypatch):
    """The planner system prompt must include `mood` as a valid category."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")

    captured: dict = {}

    def fake_create(**kwargs):
        captured["system"] = kwargs.get("system")
        return _tool_response("emit_plan", {"plan": []})
    monkeypatch.setattr(client._client.messages, "create", fake_create)

    reg = reload_registry()
    client.plan_widget_stack(
        intent="any", scope={"kind": "global"}, image_context={},
        existing_widgets=[], registry=reg, session_id="s1",
    )
    system_blob = str(captured["system"])
    assert "mood" in system_blob
    # Multi-dial stacking sentence
    assert "Multiple compound dials may stack" in system_blob


def test_planner_prompt_carries_grouping_and_budget_rubric(monkeypatch):
    """Pin the quality rubric: widget = one perceptual intention; never two
    ops on the same perceptual axis (the double-brightness failure mode)."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")

    captured: dict = {}

    def fake_create(**kwargs):
        captured["system"] = kwargs.get("system")
        return _tool_response("emit_plan", {"plan": []})
    monkeypatch.setattr(client._client.messages, "create", fake_create)

    reg = reload_registry()
    client.plan_widget_stack(
        intent="any", scope={"kind": "global"}, image_context={},
        existing_widgets=[], registry=reg, session_id="s1",
    )
    system_blob = str(captured["system"])
    assert "ONE perceptual intention" in system_blob
    assert "same perceptual axis" in system_blob
