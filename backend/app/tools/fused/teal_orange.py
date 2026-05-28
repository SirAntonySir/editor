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
            "required": ["sat_boost"],
            "properties": {
                "sat_boost": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class TealOrangeTemplate(FusedToolTemplate):
    id = "teal_orange"
    label = "Teal & orange"
    description = "Teal-and-orange cinematic grade — curve approximation plus selective saturation boost."
    typical_use = "Use when the user wants a teal-orange colour grade or cinematic look."

    node_skeleton = [
        NodeSkeleton(
            node_type="curves", fixed_params={},
            tunable_param_keys=["points"],
        ),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="points", label="Tonal curve",
            control_type="curve",
            control_schema=ControlSchema.model_validate(
                {"control_type": "curve", "channel": "luma", "min_points": 2, "max_points": 16}
            ),
            target=NodeParamTarget(node_id="n_curves", param_key="points"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="sat_boost", label="Saturation boost",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -50, "max": 50, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "sat_boost": ParamRange(min=-50, max=50, step=1, skin_safe_max=15),
    }
    safety = {"skin_protect": True}
    context_inputs = ["grade_character", "color_palette"]

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
                "grade_character": ctx.grade_character,
                "color_palette": [s.model_dump() for s in ctx.color_palette],
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
