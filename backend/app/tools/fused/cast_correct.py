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
            "required": ["corrective_kelvin", "sat_correction"],
            "properties": {
                "corrective_kelvin": {"type": "number"},
                "sat_correction": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class CastCorrectTemplate(FusedToolTemplate):
    id = "cast_correct"
    label = "Fix color cast"
    description = "Corrects colour cast — neutral white balance shift plus saturation channel blend."
    typical_use = "Use when the user wants to remove a colour cast or fix white balance."

    node_skeleton = [
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="corrective_kelvin", label="Cast correction",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -2000, "max": 2000, "step": 50, "unit": "K"}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="sat_correction", label="Saturation correction",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -30, "max": 30, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "corrective_kelvin": ParamRange(min=-2000, max=2000, step=50, skin_safe_max=400),
        "sat_correction": ParamRange(min=-30, max=30, step=1, skin_safe_max=10),
    }
    safety = {"skin_protect": True}
    context_inputs = ["estimated_white_point", "cast_direction", "wb_neutral_confidence"]

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
            "scope": scope.model_dump(mode="json", by_alias=True),
            "context_summary": {
                "estimated_white_point": ctx.estimated_white_point,
                "cast_direction": ctx.cast_direction,
                "wb_neutral_confidence": ctx.wb_neutral_confidence,
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
