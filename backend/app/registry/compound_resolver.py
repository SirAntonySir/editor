"""Compound widget resolver — applies a driver-param change to derive new
values for the op's other params via interpolation, skipping any keys the
user has locked via implicit lock-on-edit.

Backend-only; the frontend's CompoundWidgetBody performs the same math
client-side for optimistic rendering.
"""
from __future__ import annotations

from typing import Any

from app.registry.interpolate import interpolate_1d
from app.registry.schema import RegistryOp


def resolve_compound(
    widget: Any, op: RegistryOp, driver_value: float,
) -> dict[str, float]:
    """Compute the derived param updates after a driver change.

    Returns a {param_key: new_value} dict for non-locked derived params.
    Returns {} for ops without a `compound` block.
    """
    if op.compound is None:
        return {}
    bundle = interpolate_1d(op.compound.anchors, driver_value)
    locked = set(getattr(widget, "locked_params", []) or [])
    driver = op.compound.driver
    return {
        k: v for k, v in bundle.items() if k != driver and k not in locked
    }
