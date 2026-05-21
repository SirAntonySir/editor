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
            "required": ["shadows", "highlights", "whites", "blacks"],
            "properties": {
                "shadows": {"type": "number"},
                "highlights": {"type": "number"},
                "whites": {"type": "number"},
                "blacks": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class ExposureBalanceTemplate(FusedToolTemplate):
    id = "exposure_balance"
    description = "Balances tonal range — lift shadows, recover highlights, set white/black points."
    typical_use = "Use when the user wants to balance exposure, recover clipped areas, or improve tonal range."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["shadows", "highlights", "whites", "blacks"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="shadows", label="Shadows",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="shadows"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="highlights", label="Highlights",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="highlights"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="whites", label="Whites",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="whites"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="blacks", label="Blacks",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="blacks"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "shadows": ParamRange(min=-100, max=100, step=1, skin_safe_max=50),
        "highlights": ParamRange(min=-100, max=100, step=1, skin_safe_max=50),
        "whites": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
        "blacks": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
    }
    safety = {"skin_protect": True}
    context_inputs = [
        "luma_histogram", "clipped_shadows_pct", "clipped_highlights_pct", "median_luma",
    ]

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
                "luma_histogram": ctx.luma_histogram,
                "clipped_shadows_pct": ctx.clipped_shadows_pct,
                "clipped_highlights_pct": ctx.clipped_highlights_pct,
                "median_luma": ctx.median_luma,
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
