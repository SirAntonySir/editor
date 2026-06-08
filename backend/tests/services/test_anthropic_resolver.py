"""Resolver method tests — Phase 2 per-op param resolution."""
from unittest.mock import MagicMock

from app.registry.loader import reload_registry
from app.services.anthropic_client import AnthropicClient


def test_resolve_widget_params_returns_typed_dict(monkeypatch):
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    fake = MagicMock()
    fake.content = [MagicMock(text='{"shadow_hue": 200, "shadow_sat": 30, '
                                    '"highlight_hue": 30, "highlight_sat": 25, "balance": -5}')]
    monkeypatch.setattr(client._client.messages, "create",
                         MagicMock(return_value=fake))

    reg = reload_registry()
    op = reg.ops["splitTone"]
    params = client.resolve_widget_params(
        op=op,
        intent="vintage film",
        rationale="warm shadows + cool highlights",
        starting_params={},
        image_context={"palette": "warm"},
        session_id="s1",
    )
    assert params["shadow_hue"] == 200
    assert params["balance"] == -5


def test_resolve_widget_params_clamps_to_envelope(monkeypatch):
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    fake = MagicMock()
    # LLM returns out-of-range hue; client should clamp.
    fake.content = [MagicMock(text='{"shadow_hue": 999, "shadow_sat": 30, '
                                    '"highlight_hue": 30, "highlight_sat": 25, "balance": 0}')]
    monkeypatch.setattr(client._client.messages, "create",
                         MagicMock(return_value=fake))

    reg = reload_registry()
    op = reg.ops["splitTone"]
    params = client.resolve_widget_params(
        op=op, intent="vintage", rationale="warm",
        starting_params={}, image_context={}, session_id="s1",
    )
    assert params["shadow_hue"] == 360   # clamped to max
