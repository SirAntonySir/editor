from __future__ import annotations

import base64
import io
import json
import logging
from typing import Any

from anthropic import Anthropic
from PIL import Image
from pydantic import BaseModel, ValidationError

# Claude downsamples vision input to ~1568px on the long edge, so sending more
# is pure upload/latency waste. Capping here keeps analyze fast on large source
# images (a 14MP photo is ~19MB of base64 and was stalling the analyze stepper).
MAX_VISION_DIM = 1568

# Hard ceiling on a single Anthropic request so a slow/hung call surfaces as an
# error instead of blocking on the SDK's 10-minute default.
ANTHROPIC_TIMEOUT_S = 120.0

from app.schemas.enriched_context import Problem
from app.schemas.image_context import ContextRefinements, ImageContext, RegionLabel
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
ALWAYS emit at least 4 (preferably 6–10) `candidate_regions`, mixing THREE \
LEVELS OF GRANULARITY so the user can target the right scope: \
  (a) WHOLE-SUBJECT — every distinct person, animal, or major foreground object \
      as ONE region covering its full body, head to feet, clothing and held \
      objects included. For a two-person portrait you MUST emit `"left person"` \
      and `"right person"`, not just their faces. \
  (b) PART-LEVEL — useful sub-parts when retouching them matters: face, hair, \
      hands, distinct clothing, a held object. Emit IN ADDITION to (a). \
  (c) ENVIRONMENT — sky, water, walls, background, light sources, tonal zones. \
\
Region labels: short and concrete. Use whole-subject names without redundant \
qualifiers (`"right person"`, not `"right person's body"`). Parts name the part \
inside the subject (`"right person's face"`). Empty region lists are invalid. \
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
    0.5, 0.5]. Make the box TIGHT around the actual object. For a WHOLE-SUBJECT \
    region, the bbox must enclose the ENTIRE subject (head to feet), not just \
    its head. \
  - `representative_point`: [x, y]. A single point UNAMBIGUOUSLY inside the \
    region — SAM segments outward from this click, so the point determines the \
    scope. For a WHOLE-SUBJECT person, click on the TORSO/CHEST (clicking on \
    the face returns just the face). For a FACE region, click on the cheek or \
    nose. When you emit both a whole-subject and a face region for the same \
    person, the two points MUST land on different parts (torso vs face). \
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


NAME_REGION_SYSTEM_PROMPT = """You are labelling ONE region the user just \
selected in a photo. You see the original image with the region's outline \
drawn in magenta (a thick magenta line traces the selection boundary). \
\
Return a short, concrete English label naming the OUTLINED object/region. \
Match the style of the ImageContext labels you'd emit during /analyze: \
  - 3–6 words max. \
  - Use whole-subject names without redundant qualifiers (`right person`, \
    not `right person's body`). \
  - For parts, name the part inside the subject (`left person's face`, \
    `right hand`). \
  - For environment, name the thing (`sky`, `red wall`, `dark background`). \
  - Lowercase except proper nouns / brand names visible in the photo. \
\
The image context (subjects, mood, dominant tones) is provided in the user \
message — use it for disambiguation when multiple similar objects exist. \
\
Call the `emit_region_label` tool exactly once. Do not return prose."""

LABEL_REGION_TOOL = {
    "name": "emit_region_label",
    "description": "Emit a short concrete label for the magenta-outlined region.",
    "input_schema": RegionLabel.model_json_schema(),
}


class _ContextSoftFields(BaseModel):
    estimated_white_point: tuple[float, float, float]
    wb_neutral_confidence: float
    grade_character: str
    problems: list[Problem]
    region_soft_fields: list[dict]  # per-region {label, is_skin_likely, is_sky_likely}


_SOFT_FIELDS_TOOL = {
    "name": "emit_context_soft_fields",
    "description": "Emit the soft fields completing the EnrichedImageContext.",
    # Hand-rolled input_schema. The previous `_ContextSoftFields.model_json_schema()`
    # produced a pydantic-generated schema with `$defs` for the nested `Problem`
    # model. Claude consistently returned a templated placeholder
    # (`{"$PARAMETER_NAME": {...}}`) for that schema — `$defs` refs throw the
    # tool-use loop. Inlining everything removes the ambiguity.
    "input_schema": {
        "type": "object",
        "required": [
            "estimated_white_point",
            "wb_neutral_confidence",
            "grade_character",
            "problems",
            "region_soft_fields",
        ],
        "properties": {
            "estimated_white_point": {
                "type": "array",
                "description": "RGB of the most likely neutral pixels, e.g. [r, g, b] each 0-255.",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
            },
            "wb_neutral_confidence": {
                "type": "number",
                "description": "0..1 — low when no clearly-neutral region exists.",
            },
            "grade_character": {
                "type": "string",
                "description": "Short label (warm-amber / cool-cinematic / neutral / teal-orange / …).",
            },
            "problems": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["kind", "severity", "suggested_fused_tools"],
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": [
                                "clipped_highlights",
                                "crushed_shadows",
                                "low_contrast",
                                "strong_color_cast",
                                "noisy_shadows",
                                "uneven_white_balance",
                            ],
                        },
                        "severity": {"type": "number", "minimum": 0, "maximum": 1},
                        "region_label": {"type": ["string", "null"]},
                        "bbox": {
                            "type": ["array", "null"],
                            "items": {"type": "number"},
                            "minItems": 4,
                            "maxItems": 4,
                        },
                        "suggested_fused_tools": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                },
            },
            "region_soft_fields": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["label", "is_skin_likely", "is_sky_likely"],
                    "properties": {
                        "label": {"type": "string"},
                        "is_skin_likely": {"type": "boolean"},
                        "is_sky_likely": {"type": "boolean"},
                    },
                },
            },
        },
    },
}


_NAME_PICK_TOOL = {
    "name": "emit_chosen_fused_tool",
    "description": "Pick the most appropriate fused tool id for the given intent, or null.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["chosen_id"],
        "properties": {
            "chosen_id": {"type": ["string", "null"]},
            "reasoning": {"type": "string"},
        },
    },
}

_FUSED_RESOLVE_PROMPT = """You are tuning the numeric parameters of a fused photo-edit \
tool. The user (or a prior call) supplies an intent and an image context summary. \
\
Emit a single `emit_fused_tool_values` tool_use whose input matches the response \
schema you are given. Stay within the param envelope hinted in the schema; the \
calling framework clamps anything outside the envelope and may retry. \
\
Do not return prose."""

_AUGMENT_PROMPT = """You are completing an EnrichedImageContext for a photo editor. \
You see ONE image and a JSON summary of cheap statistics (histograms, median luma, cast). \
Fill in: estimated_white_point (RGB of the most likely neutral pixels), \
wb_neutral_confidence (0..1; low if no clearly-neutral region exists), \
grade_character (short label: warm-amber / cool-cinematic / neutral / teal-orange / ...), \
problems[] (one entry per detected issue with severity 0..1 and suggested_fused_tools), \
and region_soft_fields[] (per candidate region label, is_skin_likely + is_sky_likely). \
\
The valid `suggested_fused_tools` ids and what each does are listed in the catalog \
attached as a user-message text block; choose ids only from that catalog. \
\
Call the `emit_context_soft_fields` tool exactly once. Do not return prose."""


_FLESH_BINDING_PROMPT = """You are extending a fused widget with a new binding. \
Given the existing widget and the user's request, emit one new ControlBinding \
and any WidgetNode additions it needs. Return only via the emit_new_binding tool."""

_PLANNER_SYSTEM_PROMPT = """You are a photo-editing composition planner.

Given a user intent and image context, return a stack of 1–6 raw photo-editing
operations that, applied together, achieve the intent. Each op becomes a
separate widget the user can refine independently.

Rules:
- Prefer raw ops over presets unless the intent matches a preset closely.
- You may name a preset, in which case its ops will be unfolded as a starting
  point (you may add/remove ops afterward).
- Order ops by render_order (smaller = applied earlier).
- Return strict JSON. Do not include markdown fences."""


_FLESH_BINDING_TOOL = {
    "name": "emit_new_binding",
    "description": "Emit one new ControlBinding plus optional new nodes.",
    "input_schema": {
        "type": "object",
        "required": ["binding"],
        "properties": {
            "binding": {"type": "object"},
            "additional_nodes": {"type": "array"},
        },
    },
}


class AnthropicClient:
    """Wrapper around the Anthropic SDK with structured tool use + prompt caching."""

    def __init__(self, api_key: str, model: str) -> None:
        self._client = Anthropic(api_key=api_key, timeout=ANTHROPIC_TIMEOUT_S)
        self._model = model

    @staticmethod
    def _cap_image(image_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
        """Downscale to MAX_VISION_DIM on the long edge if larger, re-encoding as
        JPEG. Small images pass through untouched. Soft-fails to the original
        bytes on any decode error."""
        try:
            img = Image.open(io.BytesIO(image_bytes))
            w, h = img.size
            longest = max(w, h)
            if longest <= MAX_VISION_DIM:
                return image_bytes, mime_type
            scale = MAX_VISION_DIM / longest
            resized = img.convert("RGB").resize(
                (max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS,
            )
            buf = io.BytesIO()
            resized.save(buf, format="JPEG", quality=85)
            return buf.getvalue(), "image/jpeg"
        except Exception:
            return image_bytes, mime_type

    def _image_block(self, image_bytes: bytes, mime_type: str) -> dict[str, Any]:
        data, media_type = self._cap_image(image_bytes, mime_type)
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": base64.standard_b64encode(data).decode("ascii"),
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
                # Output budget: ImageContext + 6–10 candidate_regions (each with
                # label, description, bbox, representative_point) regularly
                # exceeds 1024 tokens. 2048 leaves comfortable headroom and
                # matches the panel endpoint.
                max_tokens=2048,
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

    def name_region(
        self,
        annotated_image: bytes,
        mime_type: str,
        context_summary: str,
        session_id: str | None = None,
    ) -> str:
        """Label a single magenta-outlined region. `context_summary` is a short
        paragraph derived from the cached ImageContext (subjects, mood, tones)
        so Claude can disambiguate similar objects (e.g. left vs right person)."""
        last_error: ValidationError | None = None
        for _ in range(2):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=128,
                system=[{"type": "text", "text": NAME_REGION_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[LABEL_REGION_TOOL],
                tool_choice={"type": "tool", "name": "emit_region_label"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(annotated_image, mime_type),
                            {"type": "text", "text": f"Image context:\n{context_summary}\n\nLabel the magenta-outlined region."},
                        ],
                    }
                ],
            )
            _log_cache_stats("name_region", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_region_label":
                    try:
                        return RegionLabel.model_validate(block.input).label
                    except ValidationError as e:
                        last_error = e
                        logger.warning("name_region validation failed, retrying: %s", e)
                        break
            else:
                raise RuntimeError("Anthropic did not emit emit_region_label tool call")
        raise RuntimeError(f"Region naming failed after retries: {last_error}")

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

    def resolve_fused_tool(
        self,
        template_id: str,
        prompt_payload: dict,
        response_schema: dict,
        session_id: str | None = None,
    ) -> dict:
        tool = {
            "name": "emit_fused_tool_values",
            "description": f"Emit tunable values for fused tool {template_id}",
            "input_schema": response_schema,
        }
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=[{"type": "text", "text": _FUSED_RESOLVE_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_fused_tool_values"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": f"Template: {template_id}"},
                    {"type": "text", "text": f"Payload: {prompt_payload}"},
                ]},
            ],
        )
        _log_cache_stats(f"resolve_fused/{template_id}", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_fused_tool_values":
                return dict(block.input)
        raise RuntimeError(f"resolve_fused_tool: no tool_use for {template_id}")

    def name_pick_fused_tool(
        self, intent: str, candidates: list[dict], session_id: str | None = None,
    ) -> str | None:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=512,
            system=[{"type": "text", "text": "Pick the fused tool id whose description best matches the intent. Return null if nothing fits.", "cache_control": {"type": "ephemeral"}}],
            tools=[_NAME_PICK_TOOL],
            tool_choice={"type": "tool", "name": "emit_chosen_fused_tool"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": f"Intent: {intent}"},
                    {"type": "text", "text": f"Candidates: {candidates}"},
                ]},
            ],
        )
        _log_cache_stats("name_pick_fused_tool", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_chosen_fused_tool":
                return block.input.get("chosen_id")
        return None

    def suggest_fused_tools_for_character(
        self,
        *,
        grade_character: str | None,
        lighting: str | None,
        dominant_tones: list[str],
        subjects: list[str],
        exclude: list[str],
        n: int,
        session_id: str | None = None,
    ) -> list[str]:
        """Ask Claude to name N fused-tool ids that fit the image's overall
        character, excluding ones already suggested. Returns template ids
        in priority order. Used by analyze_image to top up suggestions
        when problem-driven minting yields fewer than 2."""
        from app.tools.fused import all_fused_templates

        templates = list(all_fused_templates())
        catalog = [
            {"id": t.id, "description": t.description, "typical_use": t.typical_use}
            for t in templates
        ]

        tool_schema = {
            "name": "suggest_fused_tools",
            "description": "Pick fused tools that fit the image character.",
            "input_schema": {
                "type": "object",
                "additionalProperties": False,
                "required": ["picks"],
                "properties": {
                    "picks": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 0,
                        "maxItems": n,
                        "description": (
                            "Up to N fused-tool ids from the catalog, in priority order. "
                            f"N={n}. Do NOT include any id from the exclude list."
                        ),
                    },
                },
            },
        }

        user_text = (
            f"Pick up to {n} fused tools whose typical_use fits this image.\n\n"
            f"Catalog: {catalog}\n\n"
            f"Image character:\n"
            f"- grade_character: {grade_character}\n"
            f"- lighting: {lighting}\n"
            f"- dominant_tones: {dominant_tones}\n"
            f"- subjects: {subjects}\n\n"
            f"Exclude (already suggested): {exclude}\n\n"
            f"Return picks as fused-tool ids in priority order. Empty list is fine if nothing fits."
        )

        response = self._client.messages.create(
            model=self._model,
            max_tokens=512,
            system=[{"type": "text", "text": "Pick fused tools whose typical_use best fits the image's character. Skip ids in the exclude list. Return an empty list if nothing fits.", "cache_control": {"type": "ephemeral"}}],
            tools=[tool_schema],
            tool_choice={"type": "tool", "name": "suggest_fused_tools"},
            messages=[
                {"role": "user", "content": [{"type": "text", "text": user_text}]},
            ],
        )
        _log_cache_stats("suggest_fused_tools_for_character", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "suggest_fused_tools":
                picks = block.input.get("picks", []) or []
                return [p for p in picks if p not in exclude]
        return []

    def flesh_out_binding(
        self, request: str, widget: dict, response_schema: dict | None = None, session_id: str | None = None,
    ) -> dict:
        response = self._client.messages.create(
            model=self._model, max_tokens=1024,
            system=[{"type": "text", "text": _FLESH_BINDING_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[_FLESH_BINDING_TOOL],
            tool_choice={"type": "tool", "name": "emit_new_binding"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": f"Existing widget: {widget}"},
                    {"type": "text", "text": f"User request: {request}"},
                ]},
            ],
        )
        _log_cache_stats("flesh_out_binding", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_new_binding":
                return dict(block.input)
        raise RuntimeError("flesh_out_binding: no tool_use returned")

    # ------------------------------------------------------------------
    # Phase 1 planner: compose an op stack for a user intent
    # ------------------------------------------------------------------

    def plan_widget_stack(
        self,
        *,
        intent: str,
        scope: dict,
        image_context: dict,
        existing_widgets: list[dict],
        registry,
        session_id: str | None = None,
    ) -> dict:
        """Phase 1: ask Claude to compose a stack of op_ids for this intent.

        Returns: {plan: [{op_id, rationale, preset_anchor?}], overall_rationale, chosen_preset?}
        """
        import json

        ops_catalog = [
            {
                "id": op.id,
                "description": op.llm.description,
                "typical_use": op.llm.typical_use,
                "semantic_tags": op.llm.semantic_tags,
                "params": list(op.params.keys()),
                "render_order": op.engine.render_order,
            }
            for op in registry.ops.values()
        ]
        presets_catalog = [
            {
                "id": p.id,
                "description": p.description,
                "typical_use": p.typical_use,
                "semantic_tags": p.semantic_tags,
                "ops_summary": [pop.op_id for pop in p.ops],
            }
            for p in registry.presets.values()
        ]

        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "AVAILABLE OPS:\n" + str(ops_catalog) + "\n\n"
                        "AVAILABLE PRESETS:\n" + str(presets_catalog)
                    ),
                    "cache_control": {"type": "ephemeral"},
                },
                {
                    "type": "text",
                    "text": (
                        f"USER INTENT: {intent}\n"
                        f"SCOPE: {scope}\n"
                        f"IMAGE CONTEXT: {image_context}\n"
                        f"EXISTING WIDGETS (avoid duplicating): {existing_widgets}\n\n"
                        "Return JSON: "
                        '{"plan": [{"op_id": "...", "rationale": "...", '
                        '"preset_anchor": null, "starting_params": null}], '
                        '"overall_rationale": "...", "chosen_preset": null}'
                    ),
                },
            ],
        }]

        response = self._client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=[{
                "type": "text",
                "text": _PLANNER_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=messages,
        )
        _log_cache_stats("plan_widget_stack", session_id, response)
        text = response.content[0].text
        return json.loads(text)

    # ------------------------------------------------------------------
    # Phase 2 resolver: per-op numeric param resolution
    # ------------------------------------------------------------------

    _RESOLVE_SYSTEM_PROMPT = """You are resolving numeric parameter values for a single
photo-editing operation, given the user's intent and image context.

Return strict JSON matching the op's param schema. Use the starting_params as
a strong prior if provided. Do not include markdown fences."""

    def resolve_widget_params(
        self,
        *,
        op,
        intent: str,
        rationale: str,
        starting_params: dict,
        image_context: dict,
        session_id: str | None = None,
    ) -> dict:
        import json

        params_spec = {
            k: {
                "type": p.type,
                **({"range": list(p.range)} if p.range else {}),
                **({"unit": p.unit} if p.unit else {}),
                **({"values": p.values} if p.values else {}),
                "default": p.default,
            }
            for k, p in op.params.items()
        }
        user_text = (
            f"OP: {op.id} ({op.llm.description})\n"
            f"PARAM SCHEMA: {params_spec}\n"
            f"INTENT: {intent}\n"
            f"RATIONALE FROM PLANNER: {rationale}\n"
            f"STARTING PARAMS (priors): {starting_params}\n"
            f"IMAGE CONTEXT: {image_context}\n\n"
            "Return JSON object with one key per param, values within the schema range."
        )
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=[{
                "type": "text",
                "text": self._RESOLVE_SYSTEM_PROMPT + f"\n\nOP-TYPE: {op.id}",
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{
                "role": "user",
                "content": [{"type": "text", "text": user_text}],
            }],
        )
        _log_cache_stats(f"resolve_widget_params/{op.id}", session_id, response)
        raw = json.loads(response.content[0].text)

        # Clamp scalars to range, fall back to default on missing/invalid.
        resolved: dict = {}
        for key, param in op.params.items():
            if key not in raw:
                resolved[key] = param.default
                continue
            val = raw[key]
            if param.type == "scalar" and param.range:
                lo, hi = param.range
                try:
                    resolved[key] = max(lo, min(hi, float(val)))
                except (TypeError, ValueError):
                    resolved[key] = param.default
            else:
                resolved[key] = val
        return resolved

    def augment_context_soft_fields(
        self,
        image_bytes: bytes,
        mime_type: str,
        base_context_json: dict,
        cheap_pass_summary: dict,
        session_id: str | None = None,
    ) -> _ContextSoftFields:
        # Build the fused-tool catalogue dynamically so adding templates to
        # `all_fused_templates()` automatically widens the autonomous picker.
        # System prompt stays static (cache-friendly); the catalogue rides in
        # a user-message block.
        from app.tools.fused import all_fused_templates
        catalog_lines = [
            f"- {t.id}: {t.typical_use}" for t in all_fused_templates()
        ]
        catalog_block = (
            "Catalogue of valid `suggested_fused_tools` ids "
            f"({len(catalog_lines)} total):\n" + "\n".join(catalog_lines)
        )

        last_error = None
        for attempt in range(3):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1500,
                system=[{"type": "text", "text": _AUGMENT_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[_SOFT_FIELDS_TOOL],
                tool_choice={"type": "tool", "name": "emit_context_soft_fields"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(image_bytes, mime_type),
                            {"type": "text", "text": f"Cheap-pass summary: {cheap_pass_summary}"},
                            {"type": "text", "text": f"Base context: {base_context_json}"},
                            {"type": "text", "text": catalog_block},
                        ],
                    }
                ],
            )
            _log_cache_stats("augment_context", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_context_soft_fields":
                    try:
                        return _ContextSoftFields.model_validate(block.input)
                    except ValidationError as e:
                        logger.warning("augment_context validation failed (attempt %d): %s", attempt, e)
                        last_error = e
                        break
        raise RuntimeError(f"augment_context_soft_fields failed: {last_error}")
