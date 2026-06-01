"""Shared constructors for fused-template family modules. Cuts repetition for
the dozens of scalar-slider bindings the new templates share."""
from __future__ import annotations

from app.schemas.widget import ControlSchema, NodeParamTarget
from app.tools.fused_framework import BindingSkeleton, ParamRange


def slider(
    *,
    param_key: str,
    label: str,
    target_node_id: str,
    target_param_key: str | None = None,
    min: float = -100,
    max: float = 100,
    step: float = 1,
    unit: str = "",
    tunable_default: bool = True,
) -> BindingSkeleton:
    """Build a slider binding pointing at one node param.

    `target_param_key` defaults to `param_key` — the common case where the
    user-facing key and the node-param key are the same name.
    """
    return BindingSkeleton(
        param_key=param_key,
        label=label,
        control_type="slider",
        control_schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": min, "max": max, "step": step, "unit": unit}
        ),
        target=NodeParamTarget(
            node_id=target_node_id,
            param_key=target_param_key or param_key,
        ),
        tunable_default=tunable_default,
    )


def envelope(
    min: float = -100, max: float = 100, step: float = 1,
    skin_safe_max: float | None = None,
) -> ParamRange:
    return ParamRange(min=min, max=max, step=step, skin_safe_max=skin_safe_max)
