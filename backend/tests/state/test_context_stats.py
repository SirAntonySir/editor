import numpy as np

from app.state.context_stats import compute_cheap_pass


def test_uniform_grey_image_has_centered_histograms() -> None:
    img = np.full((64, 64, 3), 128, dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert sum(s.luma_histogram) == 64 * 64
    assert s.luma_histogram[128] == 64 * 64
    assert s.clipped_shadows_pct == 0.0
    assert s.clipped_highlights_pct == 0.0
    assert s.median_luma == 128.0


def test_white_image_clipped_highlights() -> None:
    img = np.full((32, 32, 3), 255, dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert s.clipped_highlights_pct == 100.0
    assert s.median_luma == 255.0


def test_black_image_clipped_shadows() -> None:
    img = np.zeros((32, 32, 3), dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert s.clipped_shadows_pct == 100.0
    assert s.median_luma == 0.0


def test_color_palette_has_at_most_8_swatches() -> None:
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, size=(64, 64, 3), dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert 1 <= len(s.color_palette) <= 8


def test_cast_direction_has_two_floats() -> None:
    img = np.full((16, 16, 3), 128, dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert len(s.cast_direction) == 2
