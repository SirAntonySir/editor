from __future__ import annotations

import base64
import json
import logging
from typing import Any

from anthropic import Anthropic
from pydantic import ValidationError

from app.schemas.image_context import ContextRefinements, ImageContext
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
tonal regions, mood, and candidate regions a user might want to edit. \
\
ALWAYS emit at least 3 (preferably 4–8) `candidate_regions` covering the \
distinct subjects, foreground objects, and notable zones a user could plausibly \
want to adjust separately (e.g. "the subject's face", "the sky", "the shadow \
on the left wall"). Empty or near-empty region lists are invalid. \
\
COORDINATE SYSTEM — read carefully, this is the most common source of errors: \
  - All coordinates are normalised to [0, 1]. \
  - The origin (0, 0) is the TOP-LEFT corner of the image. \
  - (1, 1) is the BOTTOM-RIGHT corner. \
  - The x-axis runs LEFT → RIGHT; the y-axis runs TOP → BOTTOM (NOT bottom-up). \
\
For each candidate region, emit: \
  - `bbox`: [x, y, width, height]. The (x, y) pair is the TOP-LEFT CORNER of \
    the rectangle — NOT the centre, NOT the bottom-left. So a box covering the \
    upper-left quarter of the image is [0.0, 0.0, 0.5, 0.5], NOT [0.25, 0.25, \
    0.5, 0.5]. Make the box TIGHT around the actual object: its top edge should \
    touch the topmost pixel of the object, its left edge the leftmost pixel, etc. \
  - `representative_point`: [x, y]. A single point that lies UNAMBIGUOUSLY inside \
    the visible body of the region — pick a dense, central, recognisable spot \
    (e.g. for a person, the chest; for a car, the bonnet, not the windscreen). \
    This point is fed directly to SAM as a click target — if it lands on the \
    wrong sub-part, SAM will segment that sub-part instead of the whole object. \
\
Both fields are strongly recommended; regions without `representative_point` will \
be discarded downstream. \
\
Call the `emit_image_context` tool exactly once. Do not return prose."""

# Each Node in the OperationGraph must use one of these `type` values — they
# map to ProcessingDefinitions registered in the editor. Any other type will
# be silently dropped at the graph layer.
_NODE_TYPE_GUIDE = """
Valid `node.type` values and their `params`:
  - "kelvin": white-balance shift. params: { "temperature": number 2000-12000 } (neutral 5500).
  - "basic": light + colour adjustments. params (any subset): {
      "exposure": -2..+2, "contrast": -100..+100,
      "highlights": -100..+100, "shadows": -100..+100,
      "whites": -100..+100, "blacks": -100..+100,
      "saturation": -100..+100, "vibrance": -100..+100, "hue": -180..+180
    } (neutral 0).
  - "curves": tonal curve. params: { "points": number[] } — emit only if you
    intend to construct a curve; otherwise prefer "basic".
  - "levels": input/output levels per channel. Prefer "basic" unless the user
    specifically asks for levels.
  - "lut": colour LUT preset. params: { "lutId": string } — only emit if you
    know the LUT ID; otherwise omit.
Do NOT invent types like "warmth", "temperature", "white_balance" — they will
not render. Use "kelvin" for white-balance, "basic" for everything else.
Each PanelBinding's `param_key` must reference a param emitted by its node.
"""

PANEL_SYSTEM_PROMPT = """You are a photo-editing assistant. Given an image, \
its pre-computed context, and a user goal (e.g. "make it warmer"), produce \
an OperationGraph: a small set of editing operations bound to user-facing \
controls. Each control has a goal-relevant label ("warm cast" rather than \
"kelvin = 4200"). Call the `emit_operation_graph` tool exactly once. Do not \
return prose.
""" + _NODE_TYPE_GUIDE

REFINE_SYSTEM_PROMPT = """You are a photo-editing assistant refining a prior \
suggestion. Given an image, its context, your prior OperationGraph, and a \
refinement instruction from the user (e.g. "more subtle", "only the sky"), \
produce a NEW OperationGraph that adjusts the suggestion accordingly. Keep \
labels goal-relevant. Mint a fresh graph `id`. Call the \
`emit_operation_graph` tool exactly once. Do not return prose.
""" + _NODE_TYPE_GUIDE

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

REFINE_CONTEXT_SYSTEM_PROMPT = """You are reviewing the output of an automated \
segmentation pass. You are shown ONE image: the original photo with each \
proposed region's SAM-generated mask outlined in a distinct color and labeled \
with a number (1, 2, 3, …). The numbered labels in the image correspond to the \
numbered region list provided in the user message. \
\
For EACH region, decide one of three actions: \
  - `accept` — the outlined mask correctly covers the intended object (or a \
    reasonable subset of it). No further work needed. \
  - `drop` — the outlined mask is so wrong, mis-placed, or covers an irrelevant \
    region that it should be discarded entirely. The user will not see this region. \
  - `refine` — the mask is partially correct but needs better SAM prompts. \
    Provide `refined_prompts` with one or more of: \
      • `bbox`: a tight rectangle [x, y, width, height] (top-left anchored, \
        normalised 0–1) around the intended object. STRONGLY RECOMMENDED — \
        SAM is dramatically more accurate when given a tight bbox. \
      • `positive_points`: 1–5 [x, y] points clearly INSIDE the intended \
        object. Spread them across the object (not all clustered) so SAM \
        understands the full extent. \
      • `negative_points`: 0–5 [x, y] points OUTSIDE the intended object but \
        on nearby sub-parts that SAM previously included incorrectly. Use these \
        to push SAM AWAY from over-segmenting. \
\
COORDINATE SYSTEM: all coordinates are normalised [0, 1]; origin (0, 0) is the \
top-left of the image; y runs top→bottom. `bbox` is [x_topleft, y_topleft, \
width, height], NOT centre-anchored. \
\
Call the `emit_context_refinements` tool exactly once. Do not return prose."""

CONTEXT_REFINEMENTS_TOOL = {
    "name": "emit_context_refinements",
    "description": "Emit per-region refinement actions after reviewing the annotated SAM output.",
    "input_schema": ContextRefinements.model_json_schema(),
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
        last_error: ValidationError | None = None
        for _ in range(3):  # initial + 2 retries — Claude occasionally omits required fields
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
                    try:
                        ctx = ImageContext.model_validate(block.input)
                    except ValidationError as e:
                        last_error = e
                        logger.warning("analyze validation failed, retrying: %s", e)
                        break
                    if not ctx.candidate_regions:
                        # Empty region lists pass schema validation but are unusable
                        # downstream — force a retry so Claude actually produces regions.
                        logger.warning("analyze returned empty candidate_regions, retrying")
                        last_error = ValueError("empty candidate_regions")
                        break
                    return ctx
            else:
                raise RuntimeError("Anthropic did not emit emit_image_context tool call")
        raise RuntimeError(f"Image analysis failed after retries: {last_error}")

    def refine_image_context(
        self,
        annotated_image: bytes,
        mime_type: str,
        regions: list[Any],
        session_id: str | None = None,
    ) -> ContextRefinements:
        """Show Claude the annotated composite (original + SAM outlines + numbered
        labels) and let it accept / refine / drop each region. Returns the
        refinement decisions; the caller applies them via re-running SAM."""
        region_summary = "\n".join(
            f"{i + 1}. {r.label} — {r.description}" for i, r in enumerate(regions)
        )
        last_error: ValidationError | None = None
        for _ in range(3):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=[{"type": "text", "text": REFINE_CONTEXT_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[CONTEXT_REFINEMENTS_TOOL],
                tool_choice={"type": "tool", "name": "emit_context_refinements"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(annotated_image, mime_type),
                            {
                                "type": "text",
                                "text": (
                                    "Regions, numbered to match the labels on the image:\n"
                                    f"{region_summary}\n\n"
                                    "Review each region's outlined mask and return a refinement decision."
                                ),
                            },
                        ],
                    }
                ],
            )
            _log_cache_stats("refine_context", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_context_refinements":
                    try:
                        return ContextRefinements.model_validate(block.input)
                    except ValidationError as e:
                        last_error = e
                        logger.warning("refine_image_context validation failed, retrying: %s", e)
                        break
            else:
                raise RuntimeError("Anthropic did not emit emit_context_refinements tool call")
        raise RuntimeError(f"Context refinement failed after retries: {last_error}")

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
