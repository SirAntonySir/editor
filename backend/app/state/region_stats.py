"""Per-region pixel statistics. Pure cv2/numpy pass that runs after Claude's
analyze, using Claude's bbox/representative_point to extract numeric facts
per region (mean luma, dominant colors, skin/sky likelihood overlays from
soft_fields)."""

from __future__ import annotations

import numpy as np

from app.schemas.enriched_context import RegionStats


def compute_region_stats(
    image_rgb: np.ndarray,
    base_ctx,
    region_soft_fields: list[dict],
) -> list[RegionStats]:
    """For each candidate_region with a bbox, compute per-region stats."""
    import cv2
    soft_by_label = {r.get("label"): r for r in region_soft_fields}
    out: list[RegionStats] = []
    h, w = image_rgb.shape[:2]
    for region in base_ctx.candidate_regions:
        if not region.bbox:
            continue
        x, y, bw, bh = region.bbox
        x0 = max(0, int(x * w)); y0 = max(0, int(y * h))
        x1 = min(w, int((x + bw) * w)); y1 = min(h, int((y + bh) * h))
        if x1 <= x0 or y1 <= y0:
            continue
        crop = image_rgb[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        luma = (
            0.299 * crop[:, :, 0] + 0.587 * crop[:, :, 1] + 0.114 * crop[:, :, 2]
        ).astype(np.uint8)
        hist, _ = np.histogram(luma, bins=32, range=(0, 256))
        p10 = float(np.percentile(luma, 10))
        p90 = float(np.percentile(luma, 90))
        hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        sat_mean = float(hsv[:, :, 1].mean()) / 255.0
        soft = soft_by_label.get(region.label, {})
        out.append(RegionStats(
            label=region.label,
            pixel_count=int((y1 - y0) * (x1 - x0)),
            mean_luma=float(luma.mean()),
            luma_histogram=hist.astype(int).tolist(),
            mean_rgb=(float(crop[:, :, 0].mean()), float(crop[:, :, 1].mean()), float(crop[:, :, 2].mean())),
            dominant_swatches=[],
            is_skin_likely=bool(soft.get("is_skin_likely", False)),
            is_sky_likely=bool(soft.get("is_sky_likely", False)),
            saturation_mean=sat_mean,
            contrast_p10_p90=p90 - p10,
        ))
    return out
