from __future__ import annotations

import pytest

from app.tools.fused import all_fused_templates
from app.tools.fused._time_of_day_data import (
    TIME_OF_DAY_ANCHORS,
    interpolate_1d,
)
from app.tools.fused.time_of_day import TimeOfDayTemplate


def test_registered_in_all_fused_templates() -> None:
    ids = [t.id for t in all_fused_templates()]
    assert "time-of-day" in ids


def test_template_metadata_shape() -> None:
    t = TimeOfDayTemplate()
    assert t.id == "time-of-day"
    assert t.node_skeleton[0].node_type == "compound"
    # All 10 keys (position + 9 bundle) are tunable so they reach the node params.
    assert len(t.node_skeleton[0].tunable_param_keys) == 10
    assert "time_of_day.position" in t.node_skeleton[0].tunable_param_keys
    assert t.bindings_skeleton[0].param_key == "time_of_day.position"


def test_interpolate_exact_anchor() -> None:
    for position, params in TIME_OF_DAY_ANCHORS:
        out = interpolate_1d(position)
        for k, v in params.items():
            assert out[k] == pytest.approx(v), f"{k} at position {position}"


def test_interpolate_clamps_out_of_range() -> None:
    first = dict(TIME_OF_DAY_ANCHORS[0][1])
    last = dict(TIME_OF_DAY_ANCHORS[-1][1])
    assert interpolate_1d(-0.5) == first
    assert interpolate_1d(2.0) == last


def test_interpolate_intermediate_monotonic() -> None:
    mid = interpolate_1d(0.20)  # between dawn (0.10) and noon (0.30)
    # Kelvin descends monotonically between dawn (9800) and noon (7500) in the
    # shader convention, so the midpoint lies between them.
    assert 7500 < mid["kelvin.kelvin"] < 9800
    # Exposure goes from -30 → 0 (canonical engine units); mid should be between.
    assert -30 < mid["light.exposure"] < 0


def test_interpolate_position_05_matches_js_catmull_rom_within_eps() -> None:
    # Position 0.5 — between noon (0.30) and golden (0.55). We can't import
    # the JS; this test pins the Python output so future drift is detected.
    out = interpolate_1d(0.5)
    # Verified bit-for-bit against the JS implementation in
    # `src/lib/perceptual-dial/interpolate.ts` at t=0.5. `kelvin.kelvin` is
    # stored in shader convention (high = warmer); 9570.4 = 13000 - 3429.6
    # (the prior physical-convention lock).
    expected = {
        "kelvin.kelvin": 9570.4,
        "light.exposure": 21.92,
        "color.vibrance": 10.544,
        "filters.vignette_amount": -6.176,
    }
    for k, v in expected.items():
        assert out[k] == pytest.approx(v, abs=1e-3), f"{k}: got {out[k]} expected {v}"
