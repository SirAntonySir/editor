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
            "required": [],
            "properties": {},
        },
        "reasoning": {"type": "string"},
    },
}


class BwCinematicTemplate(FusedToolTemplate):
    id = "bw_cinematic"
    label = "B&W cinematic"
    description = "Black-and-white cinematic look — applies a fixed B&W LUT with a tunable tonal curve."
    typical_use = "Use when the user wants a cinematic black-and-white conversion."

    node_skeleton = [
        NodeSkeleton(
            node_type="lut",
            fixed_params={"lutId": "bw_cinematic"},
            tunable_param_keys=[],
        ),
        NodeSkeleton(
            node_type="curves", fixed_params={},
            tunable_param_keys=["points"],
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
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope: dict[str, ParamRange] = {}
    safety = {"skin_protect": False}
    context_inputs = ["contrast_p10_p90", "luma_histogram"]

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
                "contrast_p10_p90": ctx.contrast_p10_p90,
                "luma_histogram": ctx.luma_histogram,
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
