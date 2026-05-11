from unittest.mock import MagicMock, patch

import pytest

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph
from app.services.anthropic_client import AnthropicClient


@pytest.fixture
def fake_anthropic_response_image_context() -> MagicMock:
    response = MagicMock()
    # `name` is a reserved MagicMock constructor kwarg (sets the mock's display
    # name, not `.name`), so we set it after construction.
    block = MagicMock(
        type="tool_use",
        input={
            "subjects": ["person"],
            "lighting": "backlit",
            "dominant_tones": ["shadows"],
            "mood": "calm",
            "candidate_regions": [],
            "model_name": "claude-opus-4-7",
            "model_version": "2026-01",
            "generated_at": "2026-05-11T10:00:00Z",
        },
    )
    block.name = "emit_image_context"
    response.content = [block]
    response.usage = MagicMock(cache_read_input_tokens=0, cache_creation_input_tokens=100)
    return response


def test_analyze_returns_context(fake_anthropic_response_image_context: MagicMock) -> None:
    with patch("app.services.anthropic_client.Anthropic") as MockAnthropic:
        instance = MockAnthropic.return_value
        instance.messages.create.return_value = fake_anthropic_response_image_context
        client = AnthropicClient(api_key="test", model="claude-opus-4-7")
        ctx = client.analyze_image(image_bytes=b"fake-jpeg", mime_type="image/jpeg")
        assert isinstance(ctx, ImageContext)
        assert ctx.lighting == "backlit"


def test_analyze_uses_cache_control() -> None:
    """Verify the image+system prompt is sent with cache_control markers."""
    with patch("app.services.anthropic_client.Anthropic") as MockAnthropic:
        instance = MockAnthropic.return_value
        # `name` is a reserved MagicMock constructor kwarg, set after construction.
        block = MagicMock(
            type="tool_use",
            input={
                "subjects": [],
                "lighting": "flat",
                "dominant_tones": [],
                "mood": "neutral",
                "candidate_regions": [],
                "model_name": "claude-opus-4-7",
                "model_version": "2026-01",
                "generated_at": "2026-05-11T10:00:00Z",
            },
        )
        block.name = "emit_image_context"
        instance.messages.create.return_value = MagicMock(
            content=[block],
            usage=MagicMock(),
        )
        client = AnthropicClient(api_key="test", model="claude-opus-4-7")
        client.analyze_image(image_bytes=b"fake-jpeg", mime_type="image/jpeg")
        call = instance.messages.create.call_args
        messages = call.kwargs["messages"]
        # First message is the user message with image + system text.
        user_blocks = messages[0]["content"]
        # At least one block must have cache_control.
        assert any("cache_control" in block for block in user_blocks), user_blocks
