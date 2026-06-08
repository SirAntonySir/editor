"""Time-of-Day fused tool — single compound node carrying a position scalar
and a precomputed bundle of `${op}.${param}` shader values. The LLM picks
the position from the user's intent (`night scene`, `golden hour`, ...);
this template interpolates the rest from the shared anchor table.

Frontend counterpart: `src/processing/time-of-day.tsx`.
"""
from __future__ import annotations

from typing import Any

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import (
    ResolvedNumbers,
    Scope,
    Widget,
)
from app.tools.fused._helpers import envelope, slider
from app.tools.fused._time_of_day_data import interpolate_1d
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ResolverError,
    _serialize_for_payload,
)


# The 9 compound bundle keys + `time_of_day.position`. Must mirror the JS
# `compoundToReadoutEntries` keys and the anchor table keys.
_BUNDLE_KEYS = [
    "kelvin.kelvin",
    "light.exposure",
    "light.contrast",
    "light.highlights",
    "light.shadows",
    "color.vibrance",
    "hsl.orange_sat",
    "hsl.blue_sat",
    "filters.vignette_amount",
]
_ALL_KEYS = ["time_of_day.position", *_BUNDLE_KEYS]


class TimeOfDayTemplate(FusedToolTemplate):
    id = "time-of-day"
    label = "Time of Day"
    description = (
        "A 1-D dial that re-lights the image across the day arc — dawn, noon, "
        "golden hour, blue hour, night. Compiles to a coordinated bundle of "
        "white balance, exposure, contrast, saturation, and vignette. The user "
        "can drag the dial or convert to manual widgets."
    )
    typical_use = (
        "User says 'make it night', 'golden hour', 'dawn light', 'blue hour', "
        "'sunset', 'overcast morning', 'late afternoon glow', or otherwise "
        "describes a time of day. Prefer this over individual atmosphere "
        "templates (GoldenHour, BlueHour) when the user's framing is a *time* "
        "rather than a specific look."
    )

    node_skeleton = [
        NodeSkeleton(
            node_type="compound",
            fixed_params={},
            tunable_param_keys=_ALL_KEYS,
        ),
    ]
    # All 10 compound keys are bound so `set_widget_param` can target them
    # individually. The dial owns `time_of_day.position`; the 9 bundle keys
    # are normally driven by `interpolate_1d` after a position change, but
    # explicit edits via these bindings lock the key (see
    # `set_widget_param` → `widget.locked_params`) so subsequent dial drags
    # leave them alone.
    bindings_skeleton = [
        slider(
            param_key="time_of_day.position",
            label="Time",
            target_node_id="n_compound",
            min=0, max=1, step=0.001,
        ),
        slider(param_key="light.exposure", label="Exposure",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="light.contrast", label="Contrast",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="light.highlights", label="Highlights",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="light.shadows", label="Shadows",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="color.vibrance", label="Vibrance",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="hsl.orange_sat", label="Orange Sat",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="hsl.blue_sat", label="Blue Sat",
               target_node_id="n_compound", min=-100, max=100, step=1),
        slider(param_key="kelvin.kelvin", label="WB",
               target_node_id="n_compound", min=2000, max=12000, step=50, unit="K"),
        slider(param_key="filters.vignette_amount", label="Vignette",
               target_node_id="n_compound", min=-100, max=100, step=1),
    ]
    # Envelopes for every key the LLM/dial can produce. `time_of_day.position`
    # remains the LLM's only direct output; the 9 bundle keys are derived by
    # `interpolate_1d` (so the LLM never sets them) but their envelopes still
    # exist to (a) satisfy the catalogue contract that every binding has an
    # envelope and (b) clamp any user edit through `set_widget_param`.
    param_envelope = {
        "time_of_day.position": envelope(min=0.0, max=1.0, step=0.01),
        "light.exposure": envelope(min=-100, max=100, step=1),
        "light.contrast": envelope(min=-100, max=100, step=1),
        "light.highlights": envelope(min=-100, max=100, step=1),
        "light.shadows": envelope(min=-100, max=100, step=1),
        "color.vibrance": envelope(min=-100, max=100, step=1),
        "hsl.orange_sat": envelope(min=-100, max=100, step=1),
        "hsl.blue_sat": envelope(min=-100, max=100, step=1),
        "kelvin.kelvin": envelope(min=2000, max=12000, step=50),
        "filters.vignette_amount": envelope(min=-100, max=100, step=1),
    }
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    safety = {"skin_protect": False}
    context_inputs = ["estimated_white_point", "grade_character", "luma_histogram"]

    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        """Ask the LLM for the position only; interpolate the bundle from the
        anchor table. This keeps the LLM's job narrow (one number) and the
        spawned canvas look deterministic given a position."""
        response_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["values"],
            "properties": {
                "values": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["time_of_day.position"],
                    "properties": {
                        "time_of_day.position": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 1.0,
                            "description": (
                                "Position along the day arc, 0-1. Anchors: "
                                "0.10 dawn, 0.30 noon, 0.55 golden, 0.80 blue, "
                                "1.00 night."
                            ),
                        },
                    },
                },
                "reasoning": {"type": "string"},
            },
        }
        context_summary = {
            k: _serialize_for_payload(getattr(ctx, k, None))
            for k in self.context_inputs
        }
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json"),
            "context_summary": context_summary,
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
                response_schema=response_schema,
                session_id=getattr(ctx, "model_version", None),
            )
        except Exception as exc:
            raise ResolverError(str(exc)) from exc

        partial = ResolvedNumbers.model_validate(raw)
        position = float(partial.values.get("time_of_day.position", 0.30))
        bundle = interpolate_1d(position)
        partial.values["time_of_day.position"] = position
        partial.values.update(bundle)
        return partial


__all__ = ["TimeOfDayTemplate"]
