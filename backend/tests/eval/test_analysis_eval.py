"""Ground-truth regression for the mechanical analysis + grounding pipeline.

Synthesises stimuli with a KNOWN planted defect and asserts the mechanical
pass + severity floors detect it (clear the 0.4 gate) while a clean frame
stays quiet. This is the free/CI tier of the eval harness; the LLM tier lives
in scripts/eval-analysis.py (run manually against real DNG stimuli)."""

from __future__ import annotations

import numpy as np

from app.services.analysis_eval import evaluate_rgb
from app.services.autonomous_suggestions import SEVERITY_GATE


def _structured(mean_rgb: tuple[int, int, int], spread: int = 40) -> np.ndarray:
    """A 96×96 image with some structure (a vertical ramp + tiles) centred on
    mean_rgb, so histograms/kmeans have real content to chew on."""
    h = w = 96
    ramp = np.linspace(-spread, spread, w).astype(np.float32)
    arr = np.zeros((h, w, 3), dtype=np.float32)
    for c in range(3):
        arr[:, :, c] = mean_rgb[c] + ramp[None, :]
    return np.clip(arr, 0, 255).astype(np.uint8)


def test_clean_frame_stays_below_gate():
    report = evaluate_rgb(_structured((118, 118, 118)))
    assert report.floors["strong_color_cast"] < SEVERITY_GATE
    assert report.floors["local_underexposure"] < SEVERITY_GATE


def test_blue_cast_is_detected_above_gate():
    report = evaluate_rgb(_structured((60, 110, 200)))
    assert report.cast_strength >= 0.4
    assert report.cast_direction[1] < 0  # b* negative = blue
    assert report.floors["strong_color_cast"] >= SEVERITY_GATE


def test_underexposure_is_detected_above_gate():
    report = evaluate_rgb(_structured((22, 22, 22), spread=18))
    assert report.median_luma < 40
    assert report.floors["local_underexposure"] >= SEVERITY_GATE
