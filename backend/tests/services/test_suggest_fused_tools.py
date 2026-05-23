from __future__ import annotations

from unittest.mock import MagicMock

from app.services.anthropic_client import AnthropicClient


def _fake_anthropic_response(picks: list[str]) -> MagicMock:
    """Mock anthropic.messages.create response for a tool-use call."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {"picks": picks}
    block.name = "suggest_fused_tools"
    response = MagicMock()
    response.content = [block]
    return response


def test_returns_picks_list(monkeypatch) -> None:
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    monkeypatch.setattr(
        client._client.messages, "create",
        lambda **kwargs: _fake_anthropic_response(["warm_grade", "exposure_balance"]),
    )
    picks = client.suggest_fused_tools_for_character(
        grade_character="neutral", lighting="flat",
        dominant_tones=["midtones"], subjects=["person"],
        exclude=[], n=2,
    )
    assert picks == ["warm_grade", "exposure_balance"]


def test_returns_empty_on_no_picks(monkeypatch) -> None:
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    monkeypatch.setattr(
        client._client.messages, "create",
        lambda **kwargs: _fake_anthropic_response([]),
    )
    picks = client.suggest_fused_tools_for_character(
        grade_character="neutral", lighting="flat",
        dominant_tones=[], subjects=[], exclude=[], n=2,
    )
    assert picks == []


def test_excludes_passed_through(monkeypatch) -> None:
    """The exclude list should be forwarded into the prompt — verify the
    create() call received it (not the response, which is mocked)."""
    captured: dict = {}
    def capture(**kwargs):
        captured.update(kwargs)
        return _fake_anthropic_response(["warm_grade"])
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    monkeypatch.setattr(client._client.messages, "create", capture)
    client.suggest_fused_tools_for_character(
        grade_character="warm", lighting="harsh",
        dominant_tones=["highlights"], subjects=["sky"],
        exclude=["sky_recovery"], n=1,
    )
    serialised = str(captured.get("messages", []))
    assert "sky_recovery" in serialised
