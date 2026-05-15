"""
Structural assertions that the cache_control: ephemeral marker is on the
prompt-prefix blocks (system, image, context) for both panel and refine paths,
and NOT on the per-call tail blocks (goal / prior-graph / instruction).
"""
from __future__ import annotations

from unittest.mock import MagicMock

from app.schemas.image_context import ImageContext
from app.services.anthropic_client import AnthropicClient


class _StubBlock:
    def __init__(self, name: str, value: dict) -> None:
        self.type = "tool_use"
        self.name = name
        self.input = value


def _make_client(monkeypatch, captured: list[dict]) -> AnthropicClient:
    client = AnthropicClient.__new__(AnthropicClient)
    client._client = MagicMock()  # type: ignore[attr-defined]
    client._model = "claude-opus-4-7"  # type: ignore[attr-defined]

    def fake_create(**kwargs):
        captured.append(kwargs)
        resp = MagicMock()
        resp.content = [
            _StubBlock(
                "emit_operation_graph",
                {
                    "id": "g1",
                    "user_goal": "warmer",
                    "nodes": [],
                    "panel_bindings": [],
                    "metadata": {},
                },
            )
        ]
        return resp

    client._client.messages.create = fake_create  # type: ignore[attr-defined]
    return client


def _context() -> ImageContext:
    return ImageContext.model_validate(
        {
            "subjects": ["sky"],
            "lighting": "flat",
            "dominant_tones": ["midtones"],
            "mood": "calm",
            "candidate_regions": [],
            "model_name": "claude-opus-4-7",
            "model_version": "2026-01",
            "generated_at": "2026-05-15T00:00:00Z",
        }
    )


def test_generate_panel_marks_system_image_context_cacheable(monkeypatch):
    captured: list[dict] = []
    client = _make_client(monkeypatch, captured)
    client.generate_panel(b"img", "image/jpeg", _context(), "warmer")
    assert len(captured) == 1
    kwargs = captured[0]

    # system carries cache_control
    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}

    # user content: image (idx 0) + context (idx 1) carry cache_control
    user_content = kwargs["messages"][0]["content"]
    assert user_content[0]["type"] == "image"
    assert user_content[0]["cache_control"] == {"type": "ephemeral"}
    assert user_content[1]["text"].startswith("Image context:")
    assert user_content[1]["cache_control"] == {"type": "ephemeral"}

    # tail (goal) must NOT carry cache_control
    assert user_content[2]["text"].startswith("User goal:")
    assert "cache_control" not in user_content[2]


def test_generate_refined_panel_marks_prefix_cacheable_only(monkeypatch):
    captured: list[dict] = []
    client = _make_client(monkeypatch, captured)
    client.generate_refined_panel(
        b"img", "image/jpeg", _context(), {"id": "prior", "user_goal": "warmer"}, "more subtle"
    )
    assert len(captured) == 1
    kwargs = captured[0]

    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}

    user_content = kwargs["messages"][0]["content"]
    assert user_content[0]["cache_control"] == {"type": "ephemeral"}
    assert user_content[1]["text"].startswith("Image context:")
    assert user_content[1]["cache_control"] == {"type": "ephemeral"}

    # Prior graph + instruction must NOT carry cache_control
    assert user_content[2]["text"].startswith("Prior graph:")
    assert "cache_control" not in user_content[2]
    assert user_content[3]["text"].startswith("Refinement instruction:")
    assert "cache_control" not in user_content[3]
