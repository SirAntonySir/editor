import pytest

from app.registry.interpolate import interpolate_1d
from app.registry.interpolate import interpolate_extended
from app.registry.interpolate import interpolate_linear_1d


_ANCHORS = [
    {"position": 0.0, "name": "a", "values": {"x": 0}},
    {"position": 0.5, "name": "b", "values": {"x": 50}},
    {"position": 1.0, "name": "c", "values": {"x": 100}},
]


def test_endpoint_values_when_outside_range():
    assert interpolate_1d(_ANCHORS, -0.5) == {"x": 0}
    assert interpolate_1d(_ANCHORS, 1.5) == {"x": 100}


def test_anchor_values_at_anchor_positions():
    assert interpolate_1d(_ANCHORS, 0.0)["x"] == pytest.approx(0.0, abs=1e-6)
    assert interpolate_1d(_ANCHORS, 0.5)["x"] == pytest.approx(50.0, abs=1e-6)
    assert interpolate_1d(_ANCHORS, 1.0)["x"] == pytest.approx(100.0, abs=1e-6)


def test_interpolates_smoothly_between_anchors():
    v = interpolate_1d(_ANCHORS, 0.25)["x"]
    assert 0 < v < 50


def test_raises_on_too_few_anchors():
    with pytest.raises(ValueError):
        interpolate_1d([_ANCHORS[0]], 0.5)


def _two_anchors():
    return [
        {"position": 0.0, "name": "as shot", "values": {"n_a:exposure": 0.0, "n_a:shadows": 10.0}},
        {"position": 1.0, "name": "proposed", "values": {"n_a:exposure": -80.0, "n_a:shadows": -50.0}},
    ]


def test_extended_matches_interpolate_1d_in_range():
    anchors = _two_anchors()
    assert interpolate_extended(anchors, 0.0) == {"n_a:exposure": 0.0, "n_a:shadows": 10.0}
    assert interpolate_extended(anchors, 1.0) == {"n_a:exposure": -80.0, "n_a:shadows": -50.0}
    mid = interpolate_extended(anchors, 0.5)
    assert mid["n_a:exposure"] == -40.0
    assert mid["n_a:shadows"] == -20.0
    # Delegation: in-range calls must produce identical results to interpolate_1d.
    assert interpolate_extended(anchors, 0.5) == interpolate_1d(anchors, 0.5)


def test_extended_extrapolates_past_last_anchor():
    anchors = _two_anchors()
    out = interpolate_extended(anchors, 1.5)
    # slope exposure: (-80 - 0) / 1.0 = -80 per unit → -80 + 0.5 * -80 = -120
    assert out["n_a:exposure"] == -120.0
    # slope shadows: (-50 - 10) / 1.0 = -60 → -50 + 0.5 * -60 = -80
    assert out["n_a:shadows"] == -80.0


def test_extended_extrapolates_from_last_segment_of_many():
    anchors = [
        {"position": 0.0, "name": "a", "values": {"k": 0.0}},
        {"position": 0.5, "name": "b", "values": {"k": 10.0}},
        {"position": 1.0, "name": "c", "values": {"k": 40.0}},
    ]
    # last-segment slope: (40 - 10) / 0.5 = 60 per unit → 40 + 0.25 * 60 = 55
    assert interpolate_extended(anchors, 1.25) == {"k": 55.0}


# ---------------------------------------------------------------------------
# interpolate_linear_1d — piecewise linear (mirrors frontend interpolateLinear1D)
# ---------------------------------------------------------------------------

def _three_anchors():
    return [
        {"position": 0.0, "name": "as shot",  "values": {"n_a:exposure": 0.0}},
        {"position": 1.0, "name": "proposed", "values": {"n_a:exposure": -80.0}},
        {"position": 1.5, "name": "max",      "values": {"n_a:exposure": -100.0}},
    ]


def test_linear_1d_endpoint_values():
    a = _three_anchors()
    assert interpolate_linear_1d(a, -0.1) == {"n_a:exposure": 0.0}
    assert interpolate_linear_1d(a, 1.5)  == {"n_a:exposure": -100.0}
    assert interpolate_linear_1d(a, 2.0)  == {"n_a:exposure": -100.0}


def test_linear_1d_at_anchor_positions():
    a = _three_anchors()
    assert interpolate_linear_1d(a, 0.0)["n_a:exposure"] == pytest.approx(0.0)
    assert interpolate_linear_1d(a, 1.0)["n_a:exposure"] == pytest.approx(-80.0)
    assert interpolate_linear_1d(a, 1.5)["n_a:exposure"] == pytest.approx(-100.0)


def test_linear_1d_midpoints_are_exact():
    a = _three_anchors()
    # t=0.5 → exactly halfway between 0 and -80 = -40
    assert interpolate_linear_1d(a, 0.5)["n_a:exposure"] == pytest.approx(-40.0)
    # t=1.25 → halfway between -80 and -100 = -90
    assert interpolate_linear_1d(a, 1.25)["n_a:exposure"] == pytest.approx(-90.0)


def test_linear_1d_no_overshoot_in_0_to_1_range():
    """Piecewise-linear MUST NOT overshoot between anchor 0 and anchor 1."""
    a = _three_anchors()
    for t_tenths in range(0, 11):
        t = t_tenths / 10.0
        v = interpolate_linear_1d(a, t)["n_a:exposure"]
        assert -80.0 <= v <= 0.0, f"Overshoot at t={t}: value={v}"


# ---------------------------------------------------------------------------
# interpolate_extended with mode="linear_1d"
# ---------------------------------------------------------------------------

def test_extended_linear_mode_dispatches_to_linear_1d():
    """mode='linear_1d' must produce the same result as interpolate_linear_1d in-range."""
    a = _three_anchors()
    for t in (0.0, 0.5, 1.0, 1.25, 1.5):
        ext = interpolate_extended(a, t, mode="linear_1d")
        lin = interpolate_linear_1d(a, t)
        for k in lin:
            assert ext[k] == pytest.approx(lin[k]), f"Mismatch at t={t}, key={k!r}"


def test_extended_catmull_rom_mode_unchanged():
    """mode='catmull_rom_1d' (default) must produce same results as before."""
    anchors = _two_anchors()
    # Verify the 2-anchor linear 0→1 path is still CR (same as before, which happens
    # to equal linear for 2 anchors anyway — but the dispatch must remain unchanged).
    assert interpolate_extended(anchors, 0.5) == interpolate_1d(anchors, 0.5)
    assert interpolate_extended(anchors, 1.5)["n_a:exposure"] == -120.0


