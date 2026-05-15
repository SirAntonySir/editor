from __future__ import annotations

import base64
import json
import logging
from typing import Any

from anthropic import Anthropic
from pydantic import ValidationError

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph

logger = logging.getLogger(__name__)


def _log_cache_stats(call: str, session_id: str | None, response: Any) -> None:
    usage = getattr(response, "usage", None)
    if usage is None:
        logger.warning("call=%s session=%s usage missing on response", call, session_id)
        return
    create = getattr(usage, "cache_creation_input_tokens", 0) or 0
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    total_input = getattr(usage, "input_tokens", 0) or 0
    logger.info(
        "call=%s session=%s cache_create=%d cache_read=%d input_tokens=%d",
        call, session_id, create, read, total_input,
    )

ANALYZE_SYSTEM_PROMPT = """You are a photo-editing assistant. Given an image, \
produce a structured ImageContext capturing subjects, lighting, dominant \
tonal regions, mood, and candidate regions a user might want to edit. Call \
the `emit_image_context` tool exactly once. Do not return prose."""

PANEL_SYSTEM_PROMPT = """You are a photo-editing assistant. Given an image, \
its pre-computed context, and a user goal (e.g. "make it warmer"), produce \
an OperationGraph: a small set of editing operations bound to user-facing \
controls. Each control has a goal-relevant label ("warm cast" rather than \
"kelvin = 4200"). Call the `emit_operation_graph` tool exactly once. Do not \
return prose."""

REFINE_SYSTEM_PROMPT = """You are a photo-editing assistant refining a prior \
suggestion. Given an image, its context, your prior OperationGraph, and a \
refinement instruction from the user (e.g. "more subtle", "only the sky"), \
produce a NEW OperationGraph that adjusts the suggestion accordingly. Keep \
labels goal-relevant. Mint a fresh graph `id`. Call the \
`emit_operation_graph` tool exactly once. Do not return prose."""

IMAGE_CONTEXT_TOOL = {
    "name": "emit_image_context",
    "description": "Emit the structured ImageContext for the given image.",
    "input_schema": ImageContext.model_json_schema(),
}

OPERATION_GRAPH_TOOL = {
    "name": "emit_operation_graph",
    "description": "Emit the OperationGraph for the user's goal.",
    "input_schema": OperationGraph.model_json_schema(),
}


class AnthropicClient:
    """Wrapper around the Anthropic SDK with structured tool use + prompt caching."""

    def __init__(self, api_key: str, model: str) -> None:
        self._client = Anthropic(api_key=api_key)
        self._model = model

    def _image_block(self, image_bytes: bytes, mime_type: str) -> dict[str, Any]:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": base64.standard_b64encode(image_bytes).decode("ascii"),
            },
            "cache_control": {"type": "ephemeral"},
        }

    def analyze_image(
        self,
        image_bytes: bytes,
        mime_type: str,
        session_id: str | None = None,
    ) -> ImageContext:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=[{"type": "text", "text": ANALYZE_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[IMAGE_CONTEXT_TOOL],
            tool_choice={"type": "tool", "name": "emit_image_context"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        self._image_block(image_bytes, mime_type),
                        {"type": "text", "text": "Analyse this image."},
                    ],
                }
            ],
        )
        _log_cache_stats("analyze", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_image_context":
                return ImageContext.model_validate(block.input)
        raise RuntimeError("Anthropic did not emit emit_image_context tool call")

    def generate_panel(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: ImageContext,
        user_goal: str,
        session_id: str | None = None,
    ) -> OperationGraph:
        last_error: ValidationError | None = None
        for _ in range(3):  # initial + 2 retries
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=[{"type": "text", "text": PANEL_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[OPERATION_GRAPH_TOOL],
                tool_choice={"type": "tool", "name": "emit_operation_graph"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(image_bytes, mime_type),
                            {
                                "type": "text",
                                "text": f"Image context: {context.model_dump_json()}",
                                "cache_control": {"type": "ephemeral"},
                            },
                            {"type": "text", "text": f"User goal: {user_goal}"},
                        ],
                    }
                ],
            )
            _log_cache_stats("panel", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_operation_graph":
                    try:
                        return OperationGraph.model_validate(block.input)
                    except ValidationError as e:
                        last_error = e
                        break
            else:
                raise RuntimeError("Anthropic did not emit emit_operation_graph tool call")
        raise RuntimeError(f"Panel generation failed validation after retries: {last_error}")

    def generate_refined_panel(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: ImageContext,
        prior_graph: dict[str, Any],
        instruction: str,
        session_id: str | None = None,
    ) -> OperationGraph:
        last_error: ValidationError | None = None
        for _ in range(3):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=[{"type": "text", "text": REFINE_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[OPERATION_GRAPH_TOOL],
                tool_choice={"type": "tool", "name": "emit_operation_graph"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(image_bytes, mime_type),
                            {
                                "type": "text",
                                "text": f"Image context: {context.model_dump_json()}",
                                "cache_control": {"type": "ephemeral"},
                            },
                            {
                                "type": "text",
                                "text": f"Prior graph: {json.dumps(prior_graph)}",
                            },
                            {"type": "text", "text": f"Refinement instruction: {instruction}"},
                        ],
                    }
                ],
            )
            _log_cache_stats("refine", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_operation_graph":
                    try:
                        return OperationGraph.model_validate(block.input)
                    except ValidationError as e:
                        last_error = e
                        break
            else:
                raise RuntimeError("Anthropic did not emit emit_operation_graph tool call")
        raise RuntimeError(f"Refine generation failed validation after retries: {last_error}")
