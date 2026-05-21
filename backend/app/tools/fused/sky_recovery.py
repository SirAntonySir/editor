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
            "required": ["highlights", "whites", "saturation"],
            "properties": {
                "highlights": {"type": "number"},
                "whites": {"type": "number"},
                "saturation": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class SkyRecoveryTemplate(FusedToolTemplate):
    id = "sky_recovery"
    description = "Recovers blown-out sky detail — pulls highlights/whites with a curve refinement."
    typical_use = "Use when the user wants to recover sky detail, reduce overexposed sky, or balance sky and foreground."

    node_skeleton = [
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["highlights", "whites", "saturation"],
        ),
        NodeSkeleton(
            node_type="curves", fixed_params={},
            tunable_param_keys=["points"],
        ),
    ]

    bindings_skeleton = [
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
            param_key="saturation", label="Sky saturation",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -100, "max": 100, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="points", label="Highlight curve",
            control_type="curve",
            control_schema=ControlSchema.model_validate(
                {"control_type": "curve", "channel": "luma", "min_points": 2, "max_points": 16}
            ),
            target=NodeParamTarget(node_id="n_curves", param_key="points"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "highlights": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
        "whites": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
        "saturation": ParamRange(min=-100, max=100, step=1, skin_safe_max=30),
    }
    safety = {"skin_protect": True}
    context_inputs = ["clipped_highlights_pct", "region_stats.dominant_swatches", "region_stats.is_sky_likely"]

    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        sky_swatches = [
            {"label": rs.label, "swatches": [s.model_dump() for s in rs.dominant_swatches]}
            for rs in ctx.region_stats
            if rs.is_sky_likely
        ]
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json"),
            "context_summary": {
                "clipped_highlights_pct": ctx.clipped_highlights_pct,
                "sky_swatches": sky_swatches,
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
