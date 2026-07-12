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
                    "suggested_ops": ["light"],
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


def test_soft_fields_tool_schema_uses_suggested_ops() -> None:
    """The emit_context_soft_fields tool schema must require suggested_ops,
    not the deprecated suggested_fused_tools, so the model emits registry op ids."""
    from app.services.anthropic_client import _SOFT_FIELDS_TOOL
    problem_schema = _SOFT_FIELDS_TOOL["input_schema"]["properties"]["problems"]["items"]
    assert "suggested_ops" in problem_schema["required"], (
        "suggested_ops must be required in the problems tool schema"
    )
    assert "suggested_fused_tools" not in problem_schema["required"], (
        "suggested_fused_tools must NOT be required (deprecated)"
    )
    assert "suggested_ops" in problem_schema["properties"], (
        "suggested_ops property must exist in tool schema"
    )


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


# ── resolve_widget_params: cap-5 rejected-attempts prompt block ──────────────

def _make_fake_op():
    """Minimal RegistryOp-like object with one scalar param."""
    from app.registry.schema import OpEngineConfig, OpLlmMetadata, OpParamSchema, RegistryOp
    return RegistryOp(
        id="light",
        display_name="Light",
        module="core",
        llm=OpLlmMetadata(description="Exposure and contrast", typical_use="brighten", semantic_tags=[]),
        params={"exposure": OpParamSchema(type="scalar", range=(-2.0, 2.0), default=0.0)},
        bindings=[],
        engine=OpEngineConfig(shader="basic", render_order=1, node_type="basic"),
    )


def _captured_call(monkeypatch, client):
    """Monkeypatch _messages_create to capture kwargs and return a fake JSON response."""
    captured = {}

    def _fake_create(**kwargs):
        captured.update(kwargs)
        # Minimal response that resolve_widget_params can parse (JSON text block).
        class _Block:
            text = '{"exposure": 0.5}'
        class _Resp:
            content = [_Block()]
        return _Resp()

    monkeypatch.setattr(client, "_messages_create", _fake_create)
    return captured


def test_resolve_widget_params_cap5_with_7_rejected_attempts(monkeypatch):
    """With 7 rejected attempts, the prompt must include only the last 5 and
    contain the 'do NOT repeat' instruction; value from attempt #1 must be
    absent while #7 is present."""
    from app.services.anthropic_client import AnthropicClient

    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    captured = _captured_call(monkeypatch, client)
    op = _make_fake_op()

    attempts = [{"exposure": float(i)} for i in range(1, 8)]  # attempts 1..7

    client.resolve_widget_params(
        op=op,
        intent="brighten",
        rationale="image is dark",
        starting_params={"exposure": 0.0},
        image_context={"lighting": "dim"},
        session_id="s",
        rejected_attempts=attempts,
    )

    # Extract the per_op_text block from the captured messages.
    messages = captured.get("messages", [])
    assert messages, "no messages captured"
    content_blocks = messages[0].get("content", [])
    per_op_block = next(
        (b for b in content_blocks if isinstance(b, dict) and "per_op" not in b.get("text", "IMAGE CONTEXT")),
        None,
    )
    # Simpler: join all text blocks and inspect the combined prompt.
    all_text = " ".join(
        b.get("text", "") for b in content_blocks if isinstance(b, dict)
    )

    # Attempt #1 (exposure=1.0) must be absent — capped at last 5.
    assert "1.0" not in all_text, (
        "attempt #1 (exposure=1.0) must be excluded when capped at last 5"
    )
    # Attempt #7 (exposure=7.0) must be present.
    assert "7.0" in all_text, (
        "attempt #7 (exposure=7.0) must be present (within last 5)"
    )
    # The 'do NOT repeat' instruction must be in the prompt.
    assert "do NOT repeat" in all_text, (
        "the 'do NOT repeat' instruction must appear in the rejected-attempts block"
    )


def test_resolve_widget_params_no_rejected_block_when_none(monkeypatch):
    """With rejected_attempts=None, the rejected-attempts block must be absent."""
    from app.services.anthropic_client import AnthropicClient

    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    captured = _captured_call(monkeypatch, client)
    op = _make_fake_op()

    client.resolve_widget_params(
        op=op,
        intent="brighten",
        rationale="image is dark",
        starting_params={"exposure": 0.0},
        image_context={"lighting": "dim"},
        session_id="s",
        rejected_attempts=None,
    )

    messages = captured.get("messages", [])
    all_text = " ".join(
        b.get("text", "") for b in messages[0].get("content", []) if isinstance(b, dict)
    )
    assert "PREVIOUSLY REJECTED" not in all_text, (
        "rejected-attempts block must be absent when rejected_attempts=None"
    )
    assert "do NOT repeat" not in all_text, (
        "do NOT repeat instruction must be absent when rejected_attempts=None"
    )
