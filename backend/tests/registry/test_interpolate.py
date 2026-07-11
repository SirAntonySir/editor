import pytest

from app.registry.interpolate import interpolate_1d


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


from app.registry.interpolate import interpolate_extended


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


