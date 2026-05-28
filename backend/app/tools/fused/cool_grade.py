from __future__ import annotations

from typing import Any

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import ControlSchema, NodeParamTarget, Scope, Widget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
    ResolvedNumbers,
    ResolverError,
)


_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["values"],
    "properties": {
        "values": {
            "type": "object",
            "additionalProperties": False,
            "required": ["temperature", "highlight_warmth", "saturation_lift"],
            "properties": {
                "temperature": {"type": "number"},
                "highlight_warmth": {"type": "number"},
                "saturation_lift": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class CoolGradeTemplate(FusedToolTemplate):
    id = "cool_grade"
    label = "Cool grade"
    description = "Subjective 'cooler' — mirror of warm_grade for cooling down an image or region."
    typical_use = "Use when the user asks to cool down the image, the subject, or a region."

    node_skeleton = [
        NodeSkeleton(node_type="kelvin", fixed_params={}, tunable_param_keys=["temperature"]),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["highlights", "saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="temperature", label="Coolness",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50, "unit": "K"}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="highlight_warmth", label="Highlight coolness",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -30, "max": 30, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="highlights"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="saturation_lift", label="Saturation lift",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -20, "max": 20, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "temperature": ParamRange(min=-1200, max=1200, step=50, skin_safe_max=400),
        "highlight_warmth": ParamRange(min=-30, max=30, step=1, skin_safe_max=8),
        "saturation_lift": ParamRange(min=-20, max=20, step=1, skin_safe_max=5),
    }
    safety = {"skin_protect": True}
    context_inputs = ["cast_direction", "wb_neutral_confidence", "region_stats.mean_rgb", "grade_character"]

    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json"),
            "context_summary": {
                "cast_direction": ctx.cast_direction,
                "wb_neutral_confidence": ctx.wb_neutral_confidence,
                "grade_character": ctx.grade_character,
            },
            "prior_widget_values": (
                {b.param_key: b.value for b in prior_widget.bindings}
                if prior_widget is not None else None
            ),
            "instruction": instruction,
        }
        try:
            raw = anthropic.resolve_fused_tool(
                template_id=self.id,
                prompt_payload=prompt_payload,
                response_schema=_RESPONSE_SCHEMA,
                session_id=getattr(ctx, "model_version", None),
            )
        except Exception as exc:
            raise ResolverError(str(exc)) from exc
        return ResolvedNumbers.model_validate(raw)
