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
            "candidate_regions": [
                {"label": "subject", "description": "centre figure", "representative_point": [0.5, 0.5]},
            ],
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
                "candidate_regions": [
                {"label": "subject", "description": "centre figure", "representative_point": [0.5, 0.5]},
            ],
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


from app.schemas.enriched_context import EnrichedImageContext


def test_augment_context_returns_typed_fields(monkeypatch) -> None:
    from app.services.anthropic_client import AnthropicClient
    from app.schemas.enriched_context import Problem

    class _FakeResponse:
        usage = type("U", (), {"cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "input_tokens": 0})()
        content = [type("Block", (), {
            "type": "tool_use",
            "name": "emit_context_soft_fields",
            "input": {
                "estimated_white_point": [255, 255, 255],
                "wb_neutral_confidence": 0.8,
                "grade_character": "warm-amber",
                "problems": [{
                    "kind": "clipped_highlights", "severity": 0.7,
                    "region_label": None, "bbox": None,
                    "suggested_fused_tools": ["sky_recovery"],
                }],
                "region_soft_fields": [],
            },
        })()]

    class _FakeClient:
        class messages:
            @staticmethod
            def create(**kwargs):
                return _FakeResponse()

    client = AnthropicClient(api_key="x", model="claude-opus-4-7")
    monkeypatch.setattr(client, "_client", _FakeClient())
    result = client.augment_context_soft_fields(
        image_bytes=b"x",
        mime_type="image/jpeg",
        base_context_json={
            "subjects": [], "lighting": "flat", "dominant_tones": [], "mood": "calm",
            "candidate_regions": [],
            "model_name": "x", "model_version": "y", "generated_at": "2026-05-21T00:00:00Z",
        },
        cheap_pass_summary={"median_luma": 128.0, "cast_strength": 0.1},
        session_id="s",
    )
    assert result.grade_character == "warm-amber"
    assert isinstance(result.problems[0], Problem)


def test_resolve_fused_tool_returns_dict(monkeypatch) -> None:
    from app.services.anthropic_client import AnthropicClient

    class _FakeResponse:
        usage = type("U", (), {"cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "input_tokens": 0})()
        content = [type("Block", (), {
            "type": "tool_use",
            "name": "emit_fused_tool_values",
            "input": {"values": {"temperature": 700}, "reasoning": "image is cool"},
        })()]

    class _FakeClient:
        class messages:
            @staticmethod
            def create(**kwargs):
                return _FakeResponse()

    client = AnthropicClient(api_key="x", model="claude-opus-4-7")
    monkeypatch.setattr(client, "_client", _FakeClient())
    out = client.resolve_fused_tool(
        template_id="warm_grade",
        prompt_payload={"intent": "warm"},
        response_schema={"type": "object", "properties": {"values": {"type": "object"}}},
    )
    assert out["values"]["temperature"] == 700


# ── _cap_image: downscale large vision input ────────────────────────────────

def _png_bytes(w: int, h: int) -> bytes:
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 120, 120)).save(buf, format="PNG")
    return buf.getvalue()


def test_cap_image_downscales_large_to_1568_jpeg():
    import io
    from PIL import Image
    from app.services.anthropic_client import AnthropicClient, MAX_VISION_DIM

    data, media = AnthropicClient._cap_image(_png_bytes(3055, 4547), "image/png")
    assert media == "image/jpeg"
    w, h = Image.open(io.BytesIO(data)).size
    assert max(w, h) == MAX_VISION_DIM
    # aspect ratio preserved (portrait stays portrait)
    assert h > w


def test_cap_image_passes_small_through_untouched():
    from app.services.anthropic_client import AnthropicClient

    original = _png_bytes(800, 600)
    data, media = AnthropicClient._cap_image(original, "image/png")
    assert data is original
    assert media == "image/png"


def test_cap_image_soft_fails_on_garbage():
    from app.services.anthropic_client import AnthropicClient

    data, media = AnthropicClient._cap_image(b"not an image", "image/png")
    assert data == b"not an image"
    assert media == "image/png"
