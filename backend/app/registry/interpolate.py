"""Centripetal Catmull-Rom 1D interpolation — byte-parity with
`shared/registry/lib/interpolate-1d.ts`. Used by compound-widget ops.
"""
from __future__ import annotations

from typing import Any


def _pos(a: Any) -> float:
    return a["position"] if isinstance(a, dict) else a.position


def _vals(a: Any) -> dict[str, float]:
    return a["values"] if isinstance(a, dict) else a.values


def _catmull_rom(v0: float, v1: float, v2: float, v3: float, u: float) -> float:
    u2 = u * u
    u3 = u2 * u
    return 0.5 * (
        2 * v1
        + (-v0 + v2) * u
        + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2
        + (-v0 + 3 * v1 - 3 * v2 + v3) * u3
    )


def interpolate_1d(anchors: list[Any], t: float) -> dict[str, float]:
    """Interpolate derived values at position `t` along an anchor table.

    `anchors` is a list of dicts (or Pydantic models) each with `position`
    (float), `name` (str), and `values` (dict[str, float]). Must be sorted
    by position. Out-of-range `t` clamps to the nearest endpoint's values
    verbatim. Missing keys on a neighbour default to 0.
    """
    if len(anchors) < 2:
        raise ValueError("need at least 2 anchors")

    if t <= _pos(anchors[0]):
        return dict(_vals(anchors[0]))
    if t >= _pos(anchors[-1]):
        return dict(_vals(anchors[-1]))

    i = 0
    while i < len(anchors) - 1 and _pos(anchors[i + 1]) < t:
        i += 1
    p0 = anchors[max(i - 1, 0)]
    p1 = anchors[i]
    p2 = anchors[i + 1]
    p3 = anchors[min(i + 2, len(anchors) - 1)]

    span = _pos(p2) - _pos(p1)
    u = (t - _pos(p1)) / span if span > 0 else 0.0

    v0, v1, v2, v3 = _vals(p0), _vals(p1), _vals(p2), _vals(p3)
    keys = set(v0.keys()) | set(v1.keys()) | set(v2.keys()) | set(v3.keys())
    out: dict[str, float] = {}
    for k in keys:
        out[k] = _catmull_rom(
            v0.get(k, 0.0), v1.get(k, 0.0), v2.get(k, 0.0), v3.get(k, 0.0), u
        )
    return out


def interpolate_extended(anchors: list[Any], t: float) -> dict[str, float]:
    """`interpolate_1d`, plus linear extrapolation past the LAST anchor.

    Used by fused intent widgets whose driver overshoots the proposal
    (t in (1.0, 1.5]): the value continues along the last segment's slope.
    Below the first anchor it clamps exactly like `interpolate_1d`.
    Per-param range clamping is the CALLER's job (the registry knows ranges,
    this module doesn't).
    """
    if len(anchors) < 2:
        raise ValueError("need at least 2 anchors")
    last_pos = _pos(anchors[-1])
    if t <= last_pos:
        return interpolate_1d(anchors, t)

    prev, last = anchors[-2], anchors[-1]
    span = last_pos - _pos(prev)
    if span <= 0:
        return dict(_vals(last))
    pv, lv = _vals(prev), _vals(last)
    keys = set(pv.keys()) | set(lv.keys())
    overshoot = t - last_pos
    return {
        k: lv.get(k, 0.0) + ((lv.get(k, 0.0) - pv.get(k, 0.0)) / span) * overshoot
        for k in keys
    }

