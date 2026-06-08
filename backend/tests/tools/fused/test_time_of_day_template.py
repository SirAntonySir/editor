"""Tests for the time-of-day compound op via the registry-driven path.

The bespoke TimeOfDayTemplate and _time_of_day_data modules have been deleted;
behaviour is now governed by shared/registry/ops/time-of-day.json and the
generic compound_resolver / interpolate_1d infrastructure."""
from __future__ import annotations

import pytest

from app.registry.loader import get_registry
from app.registry.interpolate import interpolate_1d


def _tod_op():
    op = get_registry().ops.get("time-of-day")
    assert op is not None, "time-of-day op not found in registry"
    return op


def _tod_anchors():
    return _tod_op().compound.anchors  # type: ignore[union-attr]


def test_tod_op_in_registry() -> None:
    op = _tod_op()
    assert op.id == "time-of-day"
    assert op.compound is not None
    assert op.compound.driver == "time_of_day.position"


def test_tod_op_has_expected_param_count() -> None:
    op = _tod_op()
    # position + 9 bundle keys
    assert len(op.params) == 10
    assert "time_of_day.position" in op.params


def test_interpolate_exact_anchor() -> None:
    anchors = _tod_anchors()
    for anchor in anchors:
        out = interpolate_1d(anchors, anchor.position)
        for k, v in anchor.values.items():
            assert out[k] == pytest.approx(v), f"{k} at position {anchor.position}"


def test_interpolate_clamps_out_of_range() -> None:
    anchors = _tod_anchors()
    first = dict(anchors[0].values)
    last = dict(anchors[-1].values)
    assert interpolate_1d(anchors, -0.5) == first
    assert interpolate_1d(anchors, 2.0) == last


def test_interpolate_intermediate_monotonic() -> None:
    anchors = _tod_anchors()
    mid = interpolate_1d(anchors, 0.20)  # between dawn (0.10) and noon (0.30)
    # Kelvin descends monotonically between dawn (9800) and noon (7500) in the
    # shader convention, so the midpoint lies between them.
    assert 7500 < mid["kelvin.kelvin"] < 9800
    # Exposure goes from -30 → 0 (canonical engine units); mid should be between.
    assert -30 < mid["light.exposure"] < 0


def test_interpolate_position_05_matches_catmull_rom_within_eps() -> None:
    # Position 0.5 — between noon (0.30) and golden (0.55). Pins Python output
    # so future drift in the anchor JSON is detected.
    anchors = _tod_anchors()
    out = interpolate_1d(anchors, 0.5)
    expected = {
        "kelvin.kelvin": 9570.4,
        "light.exposure": 21.92,
        "color.vibrance": 10.544,
        "filters.vignette_amount": -6.176,
    }
    for k, v in expected.items():
        assert out[k] == pytest.approx(v, abs=1e-3), f"{k}: got {out[k]} expected {v}"
