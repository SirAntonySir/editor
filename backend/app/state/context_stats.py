from __future__ import annotations

import cv2
import numpy as np
from pydantic import BaseModel, Field

from app.schemas.enriched_context import ColorSwatch


class CheapPassResult(BaseModel):
    """Local-only stats. Filled into EnrichedImageContext by analyze_image."""

    luma_histogram: list[int]
    rgb_histograms: dict[str, list[int]]
    clipped_shadows_pct: float
    clipped_highlights_pct: float
    median_luma: float
    contrast_p10_p90: float
    color_palette: list[ColorSwatch] = Field(default_factory=list)
    cast_strength: float
    cast_direction: tuple[float, float]


def compute_cheap_pass(image_rgb: np.ndarray) -> CheapPassResult:
    """Pure numpy/cv2 path; no Claude. Image is HxWx3 uint8 RGB."""
    assert image_rgb.dtype == np.uint8 and image_rgb.shape[-1] == 3

    # ITU-R BT.601 luma weights.
    luma = np.round(
        0.299 * image_rgb[:, :, 0] + 0.587 * image_rgb[:, :, 1] + 0.114 * image_rgb[:, :, 2]
    ).astype(np.uint8)
    luma_hist, _ = np.histogram(luma, bins=256, range=(0, 256))
    total = luma.size

    clipped_shadows_pct = float((luma <= 4).sum()) / total * 100.0
    clipped_highlights_pct = float((luma >= 251).sum()) / total * 100.0
    median_luma = float(np.median(luma))
    p10 = float(np.percentile(luma, 10))
    p90 = float(np.percentile(luma, 90))
    contrast = p90 - p10

    rgb_hists: dict[str, list[int]] = {}
    for i, ch in enumerate("rgb"):
        h, _ = np.histogram(image_rgb[:, :, i], bins=256, range=(0, 256))
        rgb_hists[ch] = h.astype(int).tolist()

    palette = _palette(image_rgb)

    # Cast: compare mean R, G, B against equal-luma neutral. Direction in Lab a*/b*.
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    a_mean = float(lab[:, :, 1].mean()) - 128.0
    b_mean = float(lab[:, :, 2].mean()) - 128.0
    cast_strength = float(min(1.0, (a_mean**2 + b_mean**2) ** 0.5 / 60.0))

    return CheapPassResult(
        luma_histogram=luma_hist.astype(int).tolist(),
        rgb_histograms=rgb_hists,
        clipped_shadows_pct=clipped_shadows_pct,
        clipped_highlights_pct=clipped_highlights_pct,
        median_luma=median_luma,
        contrast_p10_p90=contrast,
        color_palette=palette,
        cast_strength=cast_strength,
        cast_direction=(a_mean, b_mean),
    )


def _palette(image_rgb: np.ndarray, k: int = 8) -> list[ColorSwatch]:
    """Cheap k-means palette. Downsample for speed."""
    h, w = image_rgb.shape[:2]
    scale = max(1, int(max(h, w) / 256))
    small = image_rgb[::scale, ::scale]
    pixels = small.reshape(-1, 3).astype(np.float32)
    n = pixels.shape[0]
    if n < k:
        k = max(1, n)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, labels, centres = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k).astype(np.float64)
    weights = counts / counts.sum()
    palette: list[ColorSwatch] = []
    for centre, weight in zip(centres, weights):
        palette.append(ColorSwatch(
            rgb=(int(centre[0]), int(centre[1]), int(centre[2])),
            weight=float(weight),
        ))
    palette.sort(key=lambda s: s.weight, reverse=True)
    return palette
