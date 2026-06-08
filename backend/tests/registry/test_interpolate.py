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


def test_parity_with_existing_tod_anchors():
    """Verify the new library produces identical output to the existing
    fused-tool interpolate_1d at sampled positions. After Task 7 the existing
    file is deleted — this test verifies the migration didn't change values."""
    from app.tools.fused._time_of_day_data import (
        TIME_OF_DAY_ANCHORS, interpolate_1d as old_interp,
    )

    # Convert legacy (position, values_dict) tuples to the new anchor shape.
    new_anchors = [
        {"position": pos, "name": f"a{i}", "values": vals}
        for i, (pos, vals) in enumerate(TIME_OF_DAY_ANCHORS)
    ]

    for t in (0.0, 0.05, 0.1, 0.25, 0.3, 0.55, 0.65, 0.8, 0.95, 1.0):
        old = old_interp(t)
        new = interpolate_1d(new_anchors, t)
        assert set(new.keys()) == set(old.keys()), f"key mismatch at t={t}"
        for k in old:
            assert new[k] == pytest.approx(old[k], abs=1e-9), (
                f"divergence at t={t}, key={k}: old={old[k]} new={new[k]}"
            )
