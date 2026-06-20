"""Resolver method tests — Phase 2 per-op param resolution."""
from unittest.mock import MagicMock

import pytest

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


# ---------------------------------------------------------------------------
# Prompt-cache regression tests
# ---------------------------------------------------------------------------
# These tests pin the prompt shape that makes Anthropic prompt-caching work
# across the N parallel resolver calls propose_stack fires for one user
# prompt. Telemetry showed cache_read=0 on every resolver because the system
# block used to include "OP-TYPE: {op.id}", giving every call a different
# prefix and torching the cache. If a future change reintroduces a per-op
# system prompt, or drops cache_control off the image-context block, these
# tests fail and the reviewer gets a chance to think about cost.


def _resolve_with(client, monkeypatch, op_id: str, image_context: dict):
    """Run one resolver call and return the kwargs Anthropic.messages.create
    was invoked with, so tests can pin prompt shape."""
    fake = MagicMock()
    fake.content = [MagicMock(text='{"amount": 0}')]
    spy = MagicMock(return_value=fake)
    monkeypatch.setattr(client._client.messages, "create", spy)
    reg = reload_registry()
    op = reg.ops[op_id]
    client.resolve_widget_params(
        op=op, intent="dreamy underwater world",
        rationale="lift haze + lower clarity",
        starting_params={},
        image_context=image_context,
        session_id="s1",
    )
    assert spy.call_count == 1
    return spy.call_args.kwargs


class TestResolverPromptCacheShape:
    @pytest.fixture
    def client(self):
        return AnthropicClient(api_key="test", model="claude-opus-4-7")

    @pytest.fixture
    def ctx(self) -> dict:
        return {"subjects": ["fish"], "lighting": "side", "mood": "serene"}

    def test_system_prompt_is_stable_across_ops(self, client, ctx, monkeypatch):
        """The whole prompt cache key is the system prompt + the first user
        block. If the system text varies per op, cache_read is zero."""
        first = _resolve_with(client, monkeypatch, "clarity", ctx)
        second = _resolve_with(client, monkeypatch, "blur", ctx)
        assert first["system"] == second["system"], (
            "Resolver system prompt diverges across ops — the cache prefix "
            "is broken and every resolver call pays full input price. "
            "Move per-op text into the user content."
        )

    def test_system_prompt_does_not_leak_op_id(self, client, ctx, monkeypatch):
        """Direct guard against the specific regression: an earlier version
        appended `OP-TYPE: {op.id}` to the system block."""
        call = _resolve_with(client, monkeypatch, "clarity", ctx)
        sys_text = call["system"][0]["text"]
        assert "clarity" not in sys_text.lower(), (
            f"System prompt mentions the op id, breaking the cache prefix. "
            f"Text: {sys_text!r}"
        )

    def test_image_context_block_is_cache_marked(self, client, ctx, monkeypatch):
        """For the N-parallel-resolvers-per-prompt case to amortise, the
        image_context user block needs cache_control=ephemeral."""
        call = _resolve_with(client, monkeypatch, "clarity", ctx)
        user_content = call["messages"][0]["content"]
        ctx_block = next(b for b in user_content if "IMAGE CONTEXT" in b["text"])
        assert ctx_block.get("cache_control") == {"type": "ephemeral"}, (
            "IMAGE CONTEXT user block is not cache-marked. The N parallel "
            "resolver calls will all pay the full image-context tokens "
            "uncached. Re-add cache_control=ephemeral."
        )

    def test_per_op_text_lives_in_user_content_not_system(
        self, client, ctx, monkeypatch,
    ):
        """The per-op fields (OP, INTENT, RATIONALE, …) MUST be in the
        non-cached portion so the LLM sees them, but they must not be in
        the system block where they'd break the cache prefix."""
        call = _resolve_with(client, monkeypatch, "blur", ctx)
        user_content = call["messages"][0]["content"]
        joined = "\n".join(b["text"] for b in user_content)
        # `OP: <op_id>` is the canonical marker the per-op text uses.
        assert "OP: blur" in joined
        assert "INTENT:" in joined
        assert "RATIONALE FROM PLANNER:" in joined
        # And the same labels must NOT appear in the system block.
        sys_text = call["system"][0]["text"]
        assert "OP: blur" not in sys_text
        assert "INTENT:" not in sys_text
