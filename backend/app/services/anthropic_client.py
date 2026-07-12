from __future__ import annotations

import base64
import io
import json
import logging
from typing import Any

import time

from anthropic import (
    Anthropic,
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    RateLimitError,
)
from PIL import Image
from pydantic import BaseModel, ValidationError

from app.config import get_app_config
from app.schemas.enriched_context import Problem
from app.schemas.image_context import ContextRefinements, ImageContext, RegionLabel
from app.schemas.operation_graph import OperationGraph

_runtime = get_app_config().runtime
MAX_VISION_DIM = _runtime.max_vision_dim
ANTHROPIC_TIMEOUT_S = _runtime.anthropic_timeout_s
MAX_TOKENS_ANALYZE = _runtime.max_tokens_analyze
MAX_TOKENS_COMPOSE = _runtime.max_tokens_compose
MAX_TOKENS_REFINE = _runtime.max_tokens_refine
MAX_TOKENS_CLASSIFY = _runtime.max_tokens_classify
MAX_TOKENS_SHORT = _runtime.max_tokens_short
MAX_TOKENS_STACK_RESOLVE = _runtime.max_tokens_stack_resolve

logger = logging.getLogger(__name__)


def _log_cache_stats(call: str, session_id: str | None, response: Any) -> None:
    usage = getattr(response, "usage", None)
    if usage is None:
        logger.warning("call=%s session=%s usage missing on response", call, session_id)
        return
    create = getattr(usage, "cache_creation_input_tokens", 0) or 0
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    total_input = getattr(usage, "input_tokens", 0) or 0
    total_output = getattr(usage, "output_tokens", 0) or 0
    logger.info(
        "call=%s session=%s cache_create=%d cache_read=%d input_tokens=%d output_tokens=%d",
        call, session_id, create, read, total_input, total_output,
    )
    # Surface usage to any in-flight SSE consumer (frontend status bar).
    # Import lazily to avoid pulling app.state into module-import order.
    from app.state.active_doc import get_active_doc
    doc = get_active_doc()
    if doc is not None:
        doc._emit_usage(
            call=call,
            input_tokens=total_input,
            output_tokens=total_output,
            cache_create=create,
            cache_read=read,
        )

ANALYZE_SYSTEM_PROMPT = """You are a photo-editing assistant. Given an image, \
produce a structured ImageContext capturing subjects, lighting, dominant \
tonal regions, mood, and candidate regions a user might want to edit. \
\
Emit 3–6 `candidate_regions` at TWO LEVELS OF GRANULARITY only — no part-level \
sub-regions, no nested faces/hair/hands/clothing: \
  (a) WHOLE-SUBJECT — every distinct person, animal, or major foreground object \
      as ONE region covering its full body, head to feet, clothing and held \
      objects included. For a two-person portrait you MUST emit `"left person"` \
      and `"right person"`, not just their faces. \
  (b) ENVIRONMENT — sky, water, walls, background, light sources, tonal zones \
      — emit ONLY if the environment is a meaningful target a user would want \
      to grade independently (sky, water, distinct background). Do not emit \
      ground/floor as a separate region unless it's the main editing target. \
\
Each `subject` you list MUST be represented by at least one candidate_region. \
Do NOT emit a region for a part of a subject (face, hair, cap, shoes, phone, \
sweatshirt) — those belong inside the WHOLE-SUBJECT region, not as their own. \
\
Region labels: short and concrete. Use whole-subject names without redundant \
qualifiers (`"right person"`, not `"right person's body"`). Empty region lists \
are invalid. \
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
    the face would return just the face, defeating the whole-subject intent). \
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
                    "required": ["kind", "severity", "suggested_ops"],
                    "properties": {
                        "kind": {
                            "type": "string",
                            # Mirror of ProblemKind in schemas/enriched_context.py —
                            # keep the two lists in sync.
                            "enum": [
                                # Whole-image defects
                                "clipped_highlights",
                                "crushed_shadows",
                                "low_contrast",
                                "strong_color_cast",
                                "noisy_shadows",
                                "uneven_white_balance",
                                # Element-local defects (require region_label + bbox)
                                "local_underexposure",
                                "local_overexposure",
                                "soft_focus",
                                "distracting_element",
                                "dull_subject",
                                "skin_tone_shift",
                                # Journal-only escape hatch — recorded, never minted
                                "other",
                            ],
                        },
                        "severity": {"type": "number", "minimum": 0, "maximum": 1},
                        "display_label": {
                            "type": ["string", "null"],
                            "description": "2-6 words naming the issue AS SEEN in this photo (e.g. 'Blown-out sky behind the wires'), not the generic kind name.",
                        },
                        "description": {
                            "type": ["string", "null"],
                            "description": "For kind='other': what you observed that no vocabulary kind covers. Optional otherwise.",
                        },
                        "region_label": {
                            "type": ["string", "null"],
                            "description": "EXACT label of the candidate region the issue sits on. Required for element-local kinds; null for whole-image issues.",
                        },
                        "bbox": {
                            "type": ["array", "null"],
                            "items": {"type": "number"},
                            "minItems": 4,
                            "maxItems": 4,
                            "description": "Normalized [x, y, w, h] copied from the named candidate region. Set whenever region_label is set.",
                        },
                        "suggested_ops": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Registry op ids that address this problem. Choose only from the op catalog attached in the user message.",
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
tool. The user (or a prior call) supplies an intent, an image context summary, and \
`param_ranges` with each parameter's valid [min, max]. \
\
Emit a single `emit_fused_tool_values` tool_use whose input matches the response \
schema. Every value MUST lie within its declared min/max. The ranges are the tool's \
OWN relative slider scales — e.g. a hue param with range [-30, 30] is a relative \
shift in degrees, NOT an absolute 0-360 hue; a saturation param with range [-20, 40] \
is in slider units, NOT a 0-1 fraction. Values near the range limits are maximum-\
strength moves — reserve them for severe problems; prefer the smallest change that \
achieves the intent. \
\
When the `context_summary` carries MEASUREMENTS of the defect, DERIVE the \
correction from them rather than guessing from the image: size and direction \
come from the numbers, then adjust to taste. In particular — \
cast_direction is the measured cast in Lab (a*, b*): correct by moving OPPOSITE \
it (positive b* = yellow → cool/raise blue; negative b* = blue → warm; positive \
a* = red/magenta → toward green). estimated_white_point is where a neutral \
currently sits — push it back toward equal RGB. A low median/mean luma is the \
size of the exposure lift; clipped_shadows_pct / clipped_highlights_pct size \
the shadow/highlight recovery; a small contrast_p10_p90 sizes the contrast add. \
Do not re-estimate a defect the numbers already quantify. \
\
Do not return prose."""

_AUGMENT_PROMPT = """You are completing an EnrichedImageContext for a photo editor. \
You see ONE image and JSON summaries: whole-image cheap statistics (histograms, \
median luma, cast), per-region pixel statistics for each candidate region, and \
the base context with the candidate regions themselves. \
Fill in: estimated_white_point (RGB of the most likely neutral pixels), \
wb_neutral_confidence (0..1; low if no clearly-neutral region exists), \
grade_character (short label: warm-amber / cool-cinematic / neutral / teal-orange / ...), \
problems[], \
and region_soft_fields[] (per candidate region label, is_skin_likely + is_sky_likely). \
\
Detect problems in TWO passes: \
(1) WHOLE-IMAGE — global defects: clipped_highlights, crushed_shadows, low_contrast, \
strong_color_cast, noisy_shadows, uneven_white_balance. Leave region_label and bbox null. \
(2) PER-REGION — inspect EACH candidate region individually, using its image area \
and its per-region stats: local_underexposure, local_overexposure, soft_focus, \
distracting_element, dull_subject, skin_tone_shift. A global kind may also be used \
region-locally when it affects one region far more than the frame (e.g. crushed \
shadows only inside the foreground subject). For every per-region problem set \
region_label to the EXACT candidate region label and copy that region's bbox. \
\
Emit one entry per genuinely detected issue with severity 0..1 and \
suggested_ops. Do not invent issues to fill both passes; an image may have \
zero local problems. Do not duplicate the same issue at both scopes unless the \
local severity clearly exceeds the global one. \
\
For every problem also set display_label: 2-6 words naming the issue AS SEEN in \
this photo ("Blown-out sky behind the wires"), not the generic kind name — it \
becomes the title of the suggestion card the user reads. \
\
If you notice a real issue that NO kind covers, emit kind="other" with a \
description of what you see. It is recorded for vocabulary growth but not acted \
on — never force a wrong kind onto an observation. \
\
Severity 0..1, where 0.4 is the action threshold (>= 0.4 = a default viewer \
would want it fixed). For the MEASURABLE kinds below, the system re-floors your \
severity from the mechanical cheap-pass numbers you were given — so you cannot \
under-score a measurably-severe defect, and you should NOT try to guess the \
magnitude from the thumbnail. Instead score these by IMPORTANCE — how much the \
defect harms THIS photo given where it falls — and let the floor handle \
magnitude: \
- strong_color_cast: anchor on cast_strength (0..1). ~0.3+ is a real cast; a \
  scene that should contain neutrals (skin, greys, snow) with cast_strength \
  0.4+ is severe (>= 0.7). \
- crushed_shadows / clipped_highlights: anchor on clipped_shadows_pct / \
  clipped_highlights_pct (PERCENT of frame). A few percent clipped in an \
  important area is worth fixing. Note a dark image with LOW clip % is \
  underexposed, not crushed — prefer local_underexposure. \
- low_contrast: anchor on contrast_p10_p90 (0..255). A healthy frame spans \
  100+; well under that is flat. \
- local_underexposure / local_overexposure: anchor on that region's mean_luma \
  (0..255); far from mid (~115) is severe. \
Worked examples: a seascape with cast_strength 0.46 and median_luma 18 → \
strong_color_cast ~0.7 (heavy cast on water that reads neutral) AND \
local_underexposure ~0.7 on the water region. A portrait with a blown sky \
behind the subject (clipped_highlights_pct 4, sky region) → ~0.6; the same \
blowout in a far corner → ~0.3 (importance, not magnitude, is what you move). \
Judgement-only kinds (soft_focus, distracting_element, dull_subject, \
skin_tone_shift, noisy_shadows, uneven_white_balance) have no mechanical floor \
— score those fully on what you see. \
\
The valid `suggested_ops` ids and what each does are listed in the op catalog \
attached as a user-message text block; choose ids only from that catalog. \
\
Call the `emit_context_soft_fields` tool exactly once. Do not return prose."""


_FLESH_BINDING_PROMPT = """You are extending a fused widget with a new binding. \
Given the existing widget and the user's request, emit one new ControlBinding \
and any WidgetNode additions it needs. Return only via the emit_new_binding tool."""

_PLANNER_SYSTEM_PROMPT = """You are a photo-editing composition planner.

Given a user intent and image context, return a stack of 1–6 conceptually-grouped
photo-editing widgets. Each widget can carry 1–5 raw ops that belong together
conceptually. Each widget becomes ONE card on the user's canvas they can
independently refine.

Rules:
- A widget is ONE perceptual intention the user would name out loud
  ("lift the shadows", "warm it up"). Group ops into the same widget only
  when a user would refine them together as a single unit. The `category`
  field is a strong default: ops with the same category usually belong
  together unless you have a specific reason to split.
  BAD grouping: levels (tonal fade) + grain (texture) in one widget just
  because both feel "vintage" — a user refining grain does not expect the
  blacks to move.
- Prefer the MINIMUM set of ops that achieves the intent. Never add a
  second op that pushes the same perceptual axis as one already planned
  (e.g. light exposure AND levels brightening) — overlapping ops multiply
  and overshoot.
- Give each widget a short, descriptive `widget_name` (2–4 words) describing
  the EFFECT, not the op (e.g. "Lifted blacks", not "Levels op").
- Give each widget a `driver_label`: a 1–2 word noun naming the INTENT AXIS
  its strength slider will control ("Blackness", "Warmth", "Drama") — the
  quality the user asked for, not an op name. The frontend renders one
  slider with this label that scales the whole widget from "as shot" (0)
  to your resolved values (100).
- Prefer raw ops over presets unless the intent matches a preset closely.
- You may unfold a preset's ops as starting points and modify them.
- Order widgets by intent priority (most defining effect first).
- Emit the plan via the `emit_plan` tool.

Example for "vintage film":
{
  "plan": [
    {
      "widget_name": "Lifted blacks", "category": "tone", "driver_label": "Faded blacks",
      "ops": [{"op_id": "levels", "rationale": "raise inBlack to 12 for film fade"}]
    },
    {
      "widget_name": "Warm fade", "category": "color", "driver_label": "Warmth",
      "ops": [
        {"op_id": "color",     "rationale": "drop saturation -15"},
        {"op_id": "splitTone", "rationale": "warm shadows, cool highlights"}
      ]
    },
    {"widget_name": "Film grain", "category": "texture", "driver_label": "Grain",
     "ops": [{"op_id": "grain", "rationale": "fine 18% grain"}]}
  ],
  "overall_rationale": "vintage film: faded blacks + warm desaturated color + grain"
}"""


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


_PLAN_TOOL = {
    "name": "emit_plan",
    "description": "Emit the planned widget stack for the user's intent.",
    "input_schema": {
        "type": "object",
        "required": ["plan"],
        "properties": {
            "plan": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["ops"],
                    "properties": {
                        "widget_name": {"type": "string"},
                        "category": {"type": "string"},
                        "driver_label": {"type": "string"},
                        "ops": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["op_id"],
                                "properties": {
                                    "op_id": {"type": "string"},
                                    "rationale": {"type": "string"},
                                    "starting_params": {"type": "object"},
                                },
                            },
                        },
                    },
                },
            },
            "overall_rationale": {"type": "string"},
        },
    },
}


_STACK_PARAMS_TOOL = {
    "name": "emit_stack_params",
    "description": (
        "Emit resolved parameter values for every op of every entry in the "
        "planned stack. entry_index refers to the plan entry the op belongs to."
    ),
    "input_schema": {
        "type": "object",
        "required": ["entries"],
        "properties": {
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["entry_index", "ops"],
                    "properties": {
                        "entry_index": {"type": "integer"},
                        "ops": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["op_id", "params"],
                                "properties": {
                                    "op_id": {"type": "string"},
                                    "params": {"type": "object"},
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}


def clamp_op_params(op, raw: dict) -> dict:
    """Clamp LLM-emitted params to the op's schema: scalars snap to their
    declared range, missing/invalid values fall back to the registry default.
    Shared by the per-op resolver (refine_widget) and the stack resolver."""
    # A malformed tool call can hand us a non-dict `raw` (list / None / scalar);
    # treat it as "no params supplied" so every key falls back to its default,
    # rather than raising a TypeError that surfaces as an unclassified 500.
    if not isinstance(raw, dict):
        raw = {}
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


class AnthropicClient:
    """Wrapper around the Anthropic SDK with structured tool use + prompt caching."""

    def __init__(
        self,
        api_key: str,
        model: str,
        fast_model: str | None = None,
        sonnet_model: str | None = None,
    ) -> None:
        self._client = Anthropic(api_key=api_key, timeout=ANTHROPIC_TIMEOUT_S)
        self._model = model
        # Latency tier — used by smart_match (palette typing-time suggestions).
        # Falls back to the primary model so call sites work in tests that
        # construct the client with only `model=`.
        self._fast_model = fast_model or model
        # Mid tier — used by ask_about_image (palette Ask mode). Sonnet's
        # grounded narrative beats Haiku for free-form Q&A while sitting
        # well under Opus pricing. Falls back to the primary model.
        self._sonnet_model = sonnet_model or model

    def _messages_create(self, **kwargs):
        """`self._messages_create` with transport-level retries.

        The SDK raises distinct error classes for different failure modes.
        Validation retries (handled by callers) only make sense for the
        small subset where Claude emitted a tool call with malformed
        fields. Transport failures (connection drop, 5xx, 429) deserve
        their own retry with backoff before we surface them. Without
        this, a single network blip is reported to the user as a hard
        failure — yet retrying succeeds the vast majority of the time.

        4xx (other than 429) still raise: those are caller bugs, not
        transient — retrying just wastes tokens.
        """
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                return self._client.messages.create(**kwargs)
            except (APIConnectionError, APITimeoutError, RateLimitError) as exc:
                last_exc = exc
                logger.warning(
                    "Anthropic transient error (attempt %d/3): %s", attempt + 1, exc,
                )
            except APIStatusError as exc:
                last_exc = exc
                if exc.status_code is None or exc.status_code < 500:
                    # 4xx — caller bug, no point retrying. Log the response
                    # body so the actual API rejection reason ("model not
                    # found", "max_tokens too low", etc) is visible — the
                    # bare exception just shows the status code.
                    body = getattr(exc, "body", None)
                    response = getattr(exc, "response", None)
                    body_text = None
                    if body is not None:
                        body_text = str(body)
                    elif response is not None:
                        try:
                            body_text = response.text
                        except Exception:
                            body_text = None
                    logger.error(
                        "Anthropic %s (4xx) model=%s: %s | body=%s",
                        exc.status_code, kwargs.get("model"), exc, body_text,
                    )
                    raise
                logger.warning(
                    "Anthropic 5xx (attempt %d/3): %s", attempt + 1, exc,
                )
            # Exponential backoff: 0.5s, 1.0s. (No sleep after the final
            # attempt — we'll raise immediately.)
            if attempt < 2:
                time.sleep(0.5 * (2 ** attempt))
        raise RuntimeError(
            f"Anthropic transport failed after 3 attempts: {last_exc}",
        ) from last_exc

    def agent_message(self, system: str, messages: list, tools: list):
        """One turn of the agent tool-use loop (see app/tools/agent_loop.py).
        Returns the raw Anthropic response — the caller inspects
        `.stop_reason` and the `.content` tool_use blocks."""
        return self._messages_create(
            model=self._model,
            max_tokens=MAX_TOKENS_COMPOSE,
            system=system,
            messages=messages,
            tools=tools,
        )

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
            response = self._messages_create(
                model=self._model,
                # Output budget: ImageContext + 6–10 candidate_regions (each with
                # label, description, bbox, representative_point) regularly
                # exceeds 1024 tokens. 2048 leaves comfortable headroom and
                # matches the panel endpoint.
                max_tokens=MAX_TOKENS_ANALYZE,
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
        raise RuntimeError(f"Image analysis failed after retries: {last_error}") from last_error

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
            response = self._messages_create(
                model=self._model,
                max_tokens=MAX_TOKENS_ANALYZE,
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
        raise RuntimeError(f"Context refinement failed after retries: {last_error}") from last_error

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
            response = self._messages_create(
                model=self._model,
                max_tokens=MAX_TOKENS_SHORT,
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
        raise RuntimeError(f"Region naming failed after retries: {last_error}") from last_error

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
            response = self._messages_create(
                model=self._model,
                max_tokens=MAX_TOKENS_ANALYZE,
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
        raise RuntimeError(f"Panel generation failed validation after retries: {last_error}") from last_error

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
            response = self._messages_create(
                model=self._model,
                max_tokens=MAX_TOKENS_ANALYZE,
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
        raise RuntimeError(f"Refine generation failed validation after retries: {last_error}") from last_error

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
        response = self._messages_create(
            model=self._model,
            max_tokens=MAX_TOKENS_REFINE,
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
        response = self._messages_create(
            model=self._model,
            max_tokens=MAX_TOKENS_CLASSIFY,
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

    # ------------------------------------------------------------------
    # Palette typing-time smart-match
    # ------------------------------------------------------------------
    # Fired from the command palette while the user is typing. Runs on the
    # latency tier (Haiku 4.5) so we can afford to invoke it on each
    # debounced keystroke. The system prompt and the op/preset catalog are
    # marked cache-ephemeral so every call after the first is mostly
    # cache-hit — only the user's typed query and the (small) image-context
    # block are fresh per call. Returns up to N picks as
    # {"picks": [{"kind": "op"|"preset", "id": str, "reason": str}]}.

    _SMART_MATCH_PROMPT = (
        "You suggest editor commands from a typed query.\n"
        "INPUT: a short user query (a goal, mood, or look) + the current image's "
        "context (subjects, lighting, grade character) + a catalog of available "
        "ops and presets.\n"
        "OUTPUT: 0–N picks from the catalog, ranked. Each pick is an op or "
        "preset id that fits BOTH the query AND the image.\n"
        "Be aggressive about returning nothing when the deterministic palette "
        "would already find a clear match — the frontend only calls you when "
        "the literal-string search is sparse. Pick presets over ops when a "
        "preset captures the intent end-to-end. Keep `reason` under 60 chars."
    )

    def smart_match(
        self,
        *,
        query: str,
        image_context: dict | None,
        ops_catalog: list[dict],
        presets_catalog: list[dict],
        max_picks: int = 3,
        session_id: str | None = None,
    ) -> list[dict]:
        """Palette typing-time matcher. Cheap call on the Haiku tier with
        catalog + context as cache-hit blocks. Returns a list of
        {kind, id, reason} dicts of length 0..max_picks."""
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["picks"],
            "properties": {
                "picks": {
                    "type": "array",
                    "minItems": 0,
                    "maxItems": max_picks,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["kind", "id", "reason"],
                        "properties": {
                            "kind": {"type": "string", "enum": ["op", "preset"]},
                            "id": {"type": "string"},
                            "reason": {"type": "string", "maxLength": 60},
                        },
                    },
                },
            },
        }
        tool = {
            "name": "emit_smart_match_picks",
            "description": "Rank op/preset ids that fit the user's query AND the image.",
            "input_schema": schema,
        }
        # Catalog + image_context are big and stable across queries within
        # one session — they go into cached blocks. The query is the only
        # fresh content.
        catalog_text = (
            "OPS:\n" + str(ops_catalog) + "\n\nPRESETS:\n" + str(presets_catalog)
        )
        context_text = (
            "IMAGE CONTEXT:\n" + str(image_context) if image_context else "IMAGE CONTEXT: (none)"
        )
        response = self._messages_create(
            model=self._fast_model,
            max_tokens=MAX_TOKENS_SHORT,  # tight: 3 picks × ~30 tokens
            system=[{"type": "text", "text": self._SMART_MATCH_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_smart_match_picks"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": catalog_text, "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": context_text, "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": f"QUERY: {query}"},
                ]},
            ],
        )
        _log_cache_stats("smart_match", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_smart_match_picks":
                picks = block.input.get("picks") or []
                # Defensive cast — Claude occasionally returns a single dict
                # for a one-item array, or extra keys we can drop.
                out: list[dict] = []
                for p in picks:
                    if not isinstance(p, dict):
                        continue
                    kind = p.get("kind")
                    pid = p.get("id")
                    reason = p.get("reason", "")
                    if kind not in ("op", "preset") or not isinstance(pid, str) or not pid:
                        continue
                    out.append({"kind": kind, "id": pid, "reason": str(reason)[:60]})
                return out[:max_picks]
        return []

    _ASK_SYSTEM_PROMPT = (
        "You answer the user's question about the photo they are editing. "
        "You see the image plus a structured context block: the image's "
        "subjects, lighting, mood, regions, the user's current adjustment "
        "stack, any active mask, and chips the user attached for emphasis. "
        "Ground every claim in this context — never invent details the "
        "context doesn't establish. When the question is ambiguous, say "
        "what is ambiguous instead of guessing.\n\n"
        "Answer in concise GitHub-flavored Markdown. Use short headings, "
        "lists, and bold sparingly. Prefer four sentences over four "
        "paragraphs; the panel is narrow. No preamble (no 'Sure!' / 'Here "
        "is...'). No closing summary. No code fences unless the user asks "
        "for code. No links unless the user asks for them."
    )

    def ask_about_image(
        self,
        *,
        image_bytes: bytes,
        mime_type: str,
        query: str,
        image_context: dict | None,
        editor_state: dict | None,
        attached_chips: list[dict] | None,
        session_id: str | None = None,
    ) -> str:
        """Free-form Q&A about the photo — palette Ask mode entry point.

        Returns a markdown string. Runs on the mid tier (Sonnet) — better
        grounded narrative than Haiku, much cheaper than Opus. The image,
        slim image_context, editor_state (current widgets + active mask),
        and the system prompt are cache-ephemeral so repeated questions
        in one session re-use most of the prefix.
        """
        ctx_text = (
            "IMAGE CONTEXT:\n" + str(image_context) if image_context else "IMAGE CONTEXT: (none)"
        )
        editor_text = (
            "EDITOR STATE:\n" + str(editor_state) if editor_state else "EDITOR STATE: (clean — no active adjustments)"
        )
        chips_text = (
            "ATTACHED CHIPS:\n" + str(attached_chips) if attached_chips else "ATTACHED CHIPS: (none)"
        )
        response = self._messages_create(
            model=self._sonnet_model,
            max_tokens=MAX_TOKENS_REFINE,
            system=[{"type": "text", "text": self._ASK_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[
                {"role": "user", "content": [
                    self._image_block(image_bytes, mime_type),
                    {"type": "text", "text": ctx_text, "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": editor_text},
                    {"type": "text", "text": chips_text},
                    {"type": "text", "text": f"QUESTION: {query}"},
                ]},
            ],
        )
        _log_cache_stats("ask_about_image", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "text":
                return str(block.text or "").strip()
        return ""

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
        from app.registry.loader import get_registry

        templates = list(get_registry().presets.values())
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

        response = self._messages_create(
            model=self._model,
            max_tokens=MAX_TOKENS_CLASSIFY,
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
        response = self._messages_create(
            model=self._model, max_tokens=MAX_TOKENS_REFINE,
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

        def _op_catalog_entry(op):
            return {
                "id": op.id,
                "category": op.category,
                "description": op.llm.description,
                "typical_use": op.llm.typical_use,
                "semantic_tags": op.llm.semantic_tags,
                "params": list(op.params.keys()),
                "render_order": op.engine.render_order,
            }

        ops_catalog = [_op_catalog_entry(op) for op in registry.ops.values()]
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
                        "Call emit_plan with the planned stack. category is one of "
                        "tone|color|detail|texture|effect|mood."
                    ),
                },
            ],
        }]

        last_error: Exception | None = None
        for attempt in range(2):  # initial + 1 retry
            try:
                response = self._messages_create(
                    model=self._model,
                    max_tokens=MAX_TOKENS_ANALYZE,
                    system=[{
                        "type": "text",
                        "text": _PLANNER_SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }],
                    tools=[_PLAN_TOOL],
                    tool_choice={"type": "tool", "name": "emit_plan"},
                    messages=messages,
                )
            except Exception as exc:  # noqa: BLE001 — transport gave up
                last_error = exc
                self._journal_proposal_health(
                    session_id, "plan", "planner_retry", str(exc), attempt,
                )
                continue
            _log_cache_stats("plan_widget_stack", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_plan":
                    return dict(block.input)
            last_error = RuntimeError("Anthropic did not emit emit_plan tool call")
            self._journal_proposal_health(
                session_id, "plan", "planner_retry", str(last_error), attempt,
            )
        raise RuntimeError(f"plan_widget_stack failed after retries: {last_error}") from last_error

    @staticmethod
    def _journal_proposal_health(
        session_id: str | None, stage: str, event: str, detail: str, attempt: int,
    ) -> None:
        """Journal a proposal-pipeline health event (spec: holistic stack
        resolution §4). Only the retry events are written here — terminal
        failures are journaled by the propose_stack handler, which owns the
        fallback decision. Never let telemetry break the call itself."""
        if session_id is None or attempt != 0:
            return  # attempt 1 exhausts the loop — the caller journals the failure
        try:
            from app.services.event_journal import write_event
            write_event(session_id, "proposal.health", {
                "stage": stage, "event": event, "detail": detail[:500],
            })
        except Exception:  # noqa: BLE001
            logger.warning("proposal.health journal write failed", exc_info=True)

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
        rejected_attempts: list[dict] | None = None,
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
        # Build the rejected-attempts block when prior rolls were rejected.
        # Each entry is a dict of param_key → value. The block instructs the
        # resolver to produce values that are meaningfully different from all
        # listed attempts so the user sees a genuine re-roll, not noise.
        rejected_block = ""
        if rejected_attempts:
            lines = "\n".join(
                f"  Attempt {i + 1}: {attempt}"
                for i, attempt in enumerate(rejected_attempts)
            )
            rejected_block = (
                f"\nPREVIOUSLY REJECTED ATTEMPTS (do NOT repeat these values; "
                f"produce a meaningfully different result):\n{lines}\n"
            )
        # Per-op text — the only fresh content in this call. Kept compact.
        per_op_text = (
            f"OP: {op.id} ({op.llm.description})\n"
            f"PARAM SCHEMA: {params_spec}\n"
            f"INTENT: {intent}\n"
            f"RATIONALE FROM PLANNER: {rationale}\n"
            f"STARTING PARAMS (priors): {starting_params}\n"
            f"{rejected_block}\n"
            "Return JSON object with one key per param, values within the schema range."
        )
        # When propose_stack resolves N ops in parallel for one user
        # prompt, the system prompt and the image_context block are
        # identical across every call. Send them as cache-ephemeral
        # blocks so calls 2..N read the cache instead of paying the full
        # ~k input tokens each time. The previous shape put
        # "OP-TYPE: {op.id}" inside the system block which gave every
        # call a different prefix and broke the cache entirely (telemetry
        # showed cache_read=0 across 7 parallel resolvers for one prompt).
        response = self._messages_create(
            model=self._model,
            max_tokens=MAX_TOKENS_REFINE,
            system=[{
                "type": "text",
                "text": self._RESOLVE_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"IMAGE CONTEXT: {image_context}",
                        "cache_control": {"type": "ephemeral"},
                    },
                    {"type": "text", "text": per_op_text},
                ],
            }],
        )
        _log_cache_stats(f"resolve_widget_params/{op.id}", session_id, response)
        raw = json.loads(response.content[0].text)
        return clamp_op_params(op, raw)

    # ------------------------------------------------------------------
    # Holistic stack resolver: all ops of a proposed stack in ONE call
    # ------------------------------------------------------------------

    _RESOLVE_STACK_SYSTEM_PROMPT = """You are resolving numeric parameter values for an ENTIRE
stack of photo-editing operations at once, given the user's intent and image
context.

The stack's COMBINED effect must achieve the intent. Budget overlapping axes:
if two ops both raise brightness (e.g. exposure and a shadows lift), split the
correction between them — never let each op independently achieve the full
intent on its own. Prefer restrained values; the user can push further.

Use each op's starting_params as a strong prior if provided. Emit one
emit_stack_params call covering every (entry_index, op_id) in the plan."""

    def resolve_stack_params(
        self,
        *,
        plan_entries: list[dict],
        intent: str,
        image_context: dict,
        registry,
        session_id: str | None = None,
    ) -> dict[int, list[tuple[str, dict]]]:
        """Resolve params for every op of the planned stack in one call.

        Replaces the N-parallel `resolve_widget_params` calls propose_stack
        used to fire: each of those saw only its own op, so overlapping ops
        (exposure + shadows) each applied a full-strength fix and the stack
        overshot. Here the model sees the whole plan and budgets the total.

        Returns {entry_index: [(op_id, clamped_params), ...]} for the ops the
        model emitted, validated against the plan + registry. Omitted ops are
        NOT filled here — the caller falls back to clamped starting_params.
        Raises RuntimeError after two failed attempts.
        """
        plan_summary = [
            {
                "entry_index": i,
                "widget_name": entry.get("widget_name"),
                "ops": [
                    {
                        "op_id": op.get("op_id"),
                        "rationale": op.get("rationale", ""),
                        "starting_params": op.get("starting_params") or {},
                    }
                    for op in entry.get("ops", [])
                ],
            }
            for i, entry in enumerate(plan_entries)
        ]
        planned_op_ids = {
            op.get("op_id")
            for entry in plan_entries for op in entry.get("ops", [])
            if op.get("op_id") in registry.ops
        }
        params_specs = {
            op_id: {
                k: {
                    "type": p.type,
                    **({"range": list(p.range)} if p.range else {}),
                    **({"unit": p.unit} if p.unit else {}),
                    **({"values": p.values} if p.values else {}),
                    "default": p.default,
                }
                for k, p in registry.ops[op_id].params.items()
            }
            for op_id in sorted(planned_op_ids)
        }
        stack_text = (
            f"PLAN: {plan_summary}\n"
            f"PARAM SCHEMAS (per op_id): {params_specs}\n"
            f"INTENT: {intent}\n\n"
            "Resolve params for every (entry_index, op_id) above."
        )

        last_error: Exception | None = None
        for attempt in range(2):  # initial + 1 retry
            try:
                response = self._messages_create(
                    model=self._model,
                    max_tokens=MAX_TOKENS_STACK_RESOLVE,
                    system=[{
                        "type": "text",
                        "text": self._RESOLVE_STACK_SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }],
                    tools=[_STACK_PARAMS_TOOL],
                    tool_choice={"type": "tool", "name": "emit_stack_params"},
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": f"IMAGE CONTEXT: {image_context}",
                                "cache_control": {"type": "ephemeral"},
                            },
                            {"type": "text", "text": stack_text},
                        ],
                    }],
                )
            except Exception as exc:  # noqa: BLE001 — transport gave up
                last_error = exc
                self._journal_proposal_health(
                    session_id, "resolve", "resolver_retry", str(exc), attempt,
                )
                continue
            _log_cache_stats("resolve_stack_params", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_stack_params":
                    return self._bind_stack_params(
                        block.input, plan_entries, registry,
                    )
            last_error = RuntimeError("Anthropic did not emit emit_stack_params tool call")
            self._journal_proposal_health(
                session_id, "resolve", "resolver_retry", str(last_error), attempt,
            )
        raise RuntimeError(f"resolve_stack_params failed after retries: {last_error}") from last_error

    @staticmethod
    def _bind_stack_params(
        raw: dict, plan_entries: list[dict], registry,
    ) -> dict[int, list[tuple[str, dict]]]:
        """Bind an emit_stack_params payload back onto the plan: drop unknown
        entry indices / op ids, drop ops that weren't planned for that entry,
        clamp everything to the op schema."""
        planned_by_entry: dict[int, set[str]] = {
            i: {op.get("op_id") for op in entry.get("ops", [])}
            for i, entry in enumerate(plan_entries)
        }
        by_entry: dict[int, list[tuple[str, dict]]] = {}
        for entry in raw.get("entries") or []:
            idx = entry.get("entry_index")
            if idx not in planned_by_entry:
                continue
            for op_result in entry.get("ops") or []:
                op_id = op_result.get("op_id")
                if op_id not in registry.ops or op_id not in planned_by_entry[idx]:
                    continue
                params = op_result.get("params")
                if not isinstance(params, dict):
                    params = {}
                clamped = clamp_op_params(registry.ops[op_id], params)
                slot = by_entry.setdefault(idx, [])
                if any(existing == op_id for existing, _ in slot):
                    continue  # first emission wins on duplicates
                slot.append((op_id, clamped))
        return by_entry

    def augment_context_soft_fields(
        self,
        image_bytes: bytes,
        mime_type: str,
        base_context_json: dict,
        cheap_pass_summary: dict,
        session_id: str | None = None,
    ) -> _ContextSoftFields:
        # Build the op catalogue dynamically from the SSoT registry so adding/
        # removing an op JSON automatically widens or narrows the picker.
        # System prompt stays static (cache-friendly); the catalogue rides in a
        # user-message block. The model emits registry op ids in suggested_ops.
        from app.registry.loader import get_registry
        catalog_lines = [
            f"- {op.id}: {op.llm.description} ({op.llm.typical_use})"
            for op in get_registry().ops.values()
        ]
        catalog_block = (
            "Op catalog for `suggested_ops` "
            f"({len(catalog_lines)} ops — use only these ids):\n"
            + "\n".join(catalog_lines)
        )

        last_error = None
        for attempt in range(3):
            response = self._messages_create(
                model=self._model,
                max_tokens=MAX_TOKENS_COMPOSE,
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
        raise RuntimeError(f"augment_context_soft_fields failed: {last_error}") from last_error
