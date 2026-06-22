/**
 * Match a freshly-segmented mask against the AI's named regions by bbox
 * overlap, so a SAM commit can inherit the region's label instead of the
 * "Object N" default. The user sees `pasta dish` show up in the Layer
 * tab and the Objects markers without typing.
 *
 * Two coordinate spaces meet here:
 *  - The mask is alpha bytes in its own pixel grid (mask.width × mask.height).
 *  - CandidateRegion.bbox is in normalised image-space (0..1).
 *
 * Both are normalised to 0..1 before IoU; we don't assume the mask matches
 * the source image's resolution (SAM masks often come back at a smaller
 * working resolution).
 */

import type { CandidateRegion } from '@/types/image-context';

/** Compute the inclusive pixel bbox of the white (255) region in a mask.
 *  Returns null when the mask is empty. Inlined here (rather than imported
 *  from store/segment-actions) so this module stays free of the WebGL
 *  layer-compositor pull chain — the matcher runs at SAM-commit time in
 *  the browser AND in pure-node unit tests. */
function computeMaskBbox(
  data: Uint8Array, width: number, height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] !== 255) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

const IOU_THRESHOLD = 0.4;

interface Rect {
  x: number; // top-left x
  y: number; // top-left y
  w: number; // width
  h: number; // height
}

function rectIoU(a: Rect, b: Rect): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Convert a pixel bbox + grid size into a normalised 0..1 rect. */
function pxBboxToNorm(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
): Rect {
  return {
    x: bbox.minX / width,
    y: bbox.minY / height,
    w: (bbox.maxX - bbox.minX + 1) / width,
    h: (bbox.maxY - bbox.minY + 1) / height,
  };
}

/**
 * Find the AI-named region whose normalised bbox overlaps the given mask
 * the most, above a sensible IoU threshold. Returns the region's label or
 * `null` when no candidate scores well enough — the caller falls back to
 * its existing default ("Object N").
 */
export function matchRegionLabelByBbox(
  mask: { width: number; height: number; data: Uint8Array },
  regions: CandidateRegion[] | undefined,
): string | null {
  if (!regions || regions.length === 0) return null;
  const pxBbox = computeMaskBbox(mask.data, mask.width, mask.height);
  if (!pxBbox) return null;
  const maskRect = pxBboxToNorm(pxBbox, mask.width, mask.height);

  let bestLabel: string | null = null;
  let bestIoU = IOU_THRESHOLD; // require beating the threshold to count
  for (const r of regions) {
    if (!r.bbox) continue;
    const [x, y, w, h] = r.bbox;
    const iou = rectIoU(maskRect, { x, y, w, h });
    if (iou > bestIoU) {
      bestIoU = iou;
      bestLabel = r.label;
    }
  }
  return bestLabel;
}
