"""Planner method tests use a faked anthropic SDK call."""
from unittest.mock import MagicMock

from app.registry.loader import reload_registry
from app.services.anthropic_client import AnthropicClient


def test_plan_widget_stack_returns_op_plan(monkeypatch):
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    fake_response = MagicMock()
    fake_response.content = [MagicMock(text=(
        '{"plan": ['
        '  {"op_id": "levels", "rationale": "lift blacks for film"},'
        '  {"op_id": "splitTone", "rationale": "warm/cool tone"},'
        '  {"op_id": "grain", "rationale": "film texture"}'
        '], "overall_rationale": "vintage film recipe"}'
    ))]
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
    fake = MagicMock()
    fake.content = [MagicMock(text=(
        '{"plan": ['
        '  {"widget_name": "Lifted blacks", "category": "tone",'
        '   "ops": [{"op_id": "levels", "rationale": "raise inBlack", "starting_params": {"inBlack": 12}}]},'
        '  {"widget_name": "Warm fade", "category": "color",'
        '   "ops": ['
        '     {"op_id": "color",     "rationale": "desat -15", "starting_params": {"saturation": -15}},'
        '     {"op_id": "splitTone", "rationale": "teal/orange", "starting_params": null}'
        '   ]}'
        '], "overall_rationale": "vintage film"}'
    ))]
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


def test_plan_widget_stack_catalog_surfaces_compound_dial(monkeypatch):
    """The ops catalog sent to the planner must include `compound_dial` info
    for compound ops so the model knows time-of-day is a 1D dial, not a
    manual stack of N tone+color sliders."""
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")

    captured: dict = {}

    def fake_create(**kwargs):
        captured["messages"] = kwargs.get("messages")
        captured["system"] = kwargs.get("system")
        resp = MagicMock()
        resp.content = [MagicMock(text='{"plan": []}')]
        return resp

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

    catalog_blob = captured["messages"][0]["content"][0]["text"]
    # The TOD op's compound_dial info must be visible to the LLM.
    assert "time-of-day" in catalog_blob
    assert "compound_dial" in catalog_blob
    assert "time_of_day.position" in catalog_blob
    # Anchor names should be surfaced so the model picks the right position.
    for name in ("dawn", "noon", "golden", "blue", "night"):
        assert name in catalog_blob

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
        resp = MagicMock()
        resp.content = [MagicMock(text='{"plan": []}')]
        return resp
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
