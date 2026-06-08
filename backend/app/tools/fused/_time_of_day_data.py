"""Time-of-Day anchor table and 1-D Catmull-Rom interpolation — Python parity
of `src/processing/anchors/time-of-day-anchors.ts` and
`src/lib/perceptual-dial/interpolate.ts`. Kept verbatim so that a `position`
value resolves to the same compound bundle on backend and frontend.

`kelvin.kelvin` values follow the shader convention (high value = warmer
apparent image) — see `src/lib/kelvin-direction.ts` for the rule. Stored
values are `2 * 6500 - physical_kelvin` of the lighting condition emulated.

If you change values here, update the JS copies in lockstep.
"""
from __future__ import annotations

# Each anchor: (position, params)
# `params` keys are `${op}.${param}` strings as defined by the frontend.
TIME_OF_DAY_ANCHORS: list[tuple[float, dict[str, float]]] = [
    (0.10, {  # dawn
        "kelvin.kelvin": 9800,
        "light.exposure": -0.3,
        "light.contrast": -8,
        "light.highlights": -15,
        "light.shadows": 20,
        "color.vibrance": 5,
        "hsl.orange_sat": 10,
        "hsl.blue_sat": 15,
        "filters.vignette_amount": -10,
    }),
    (0.30, {  # noon
        "kelvin.kelvin": 7500,
        "light.exposure": 0,
        "light.contrast": 10,
        "light.highlights": 0,
        "light.shadows": 0,
        "color.vibrance": 0,
        "hsl.orange_sat": 0,
        "hsl.blue_sat": 15,
        "filters.vignette_amount": 0,
    }),
    (0.55, {  # golden
        "kelvin.kelvin": 9600,
        "light.exposure": 0.2,
        "light.contrast": 5,
        "light.highlights": -20,
        "light.shadows": 10,
        "color.vibrance": 12,
        "hsl.orange_sat": 25,
        "hsl.blue_sat": -5,
        "filters.vignette_amount": -8,
    }),
    (0.80, {  # blue
        "kelvin.kelvin": 4500,
        "light.exposure": -0.5,
        "light.contrast": 15,
        "light.highlights": -10,
        "light.shadows": 5,
        "color.vibrance": 5,
        "hsl.orange_sat": -25,
        "hsl.blue_sat": 20,
        "filters.vignette_amount": -15,
    }),
    (1.00, {  # night
        "kelvin.kelvin": 8800,
        "light.exposure": -1.2,
        "light.contrast": 25,
        "light.highlights": -40,
        "light.shadows": -10,
        "color.vibrance": 8,
        "hsl.orange_sat": -10,
        "hsl.blue_sat": 15,
        "filters.vignette_amount": -30,
    }),
]


def _catmull_rom(v0: float, v1: float, v2: float, v3: float, u: float) -> float:
    """Centripetal-style Catmull-Rom scalar interp; tension 0.5 (standard)."""
    u2 = u * u
    u3 = u2 * u
    return 0.5 * (
        (2 * v1)
        + (-v0 + v2) * u
        + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2
        + (-v0 + 3 * v1 - 3 * v2 + v3) * u3
    )


def interpolate_1d(t: float) -> dict[str, float]:
    """1-D Catmull-Rom across the Time-of-Day anchors at scalar `t` in [0, 1].
    Returns the compound params dict. Out-of-range `t` clamps to the nearest
    endpoint's params verbatim. Missing keys on either neighbour default to 0.
    """
    anchors = sorted(TIME_OF_DAY_ANCHORS, key=lambda a: a[0])
    if t <= anchors[0][0]:
        return dict(anchors[0][1])
    if t >= anchors[-1][0]:
        return dict(anchors[-1][1])

    # Find segment [p1, p2] containing t.
    i = 0
    while i < len(anchors) - 1 and anchors[i + 1][0] < t:
        i += 1
    p0 = anchors[max(i - 1, 0)]
    p1 = anchors[i]
    p2 = anchors[i + 1]
    p3 = anchors[min(i + 2, len(anchors) - 1)]

    span = p2[0] - p1[0]
    u = (t - p1[0]) / span if span > 0 else 0

    keys = set(p0[1].keys()) | set(p1[1].keys()) | set(p2[1].keys()) | set(p3[1].keys())
    out: dict[str, float] = {}
    for k in keys:
        v0 = p0[1].get(k, 0)
        v1 = p1[1].get(k, 0)
        v2 = p2[1].get(k, 0)
        v3 = p3[1].get(k, 0)
        out[k] = _catmull_rom(v0, v1, v2, v3, u)
    return out
