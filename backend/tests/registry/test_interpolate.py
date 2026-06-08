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


