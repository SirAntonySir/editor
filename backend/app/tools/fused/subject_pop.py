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
            "required": ["contrast", "saturation"],
            "properties": {
                "contrast": {"type": "number"},
                "saturation": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class SubjectPopTemplate(FusedToolTemplate):
    id = "subject_pop"
    description = "Makes a subject or region pop — local contrast and saturation boost."
    typical_use = "Use when the user wants to make a subject, person, or region stand out."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["contrast", "saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="contrast", label="Contrast pop",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -50, "max": 50, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="contrast"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="saturation", label="Saturation pop",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -30, "max": 30, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "non_global"
    param_envelope = {
        "contrast": ParamRange(min=-50, max=50, step=1, skin_safe_max=15),
        "saturation": ParamRange(min=-30, max=30, step=1, skin_safe_max=10),
    }
    safety = {"skin_protect": True}
    context_inputs = ["region_stats.contrast_p10_p90", "region_stats.is_skin_likely"]

    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        region_info = [
            {
                "label": rs.label,
                "contrast_p10_p90": rs.contrast_p10_p90,
                "is_skin_likely": rs.is_skin_likely,
            }
            for rs in ctx.region_stats
        ]
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json"),
            "context_summary": {
                "region_stats": region_info,
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
