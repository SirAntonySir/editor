import type { Mask } from '@/core/mask-store';

/**
 * Resample a binary mask to a target resolution using nearest-neighbour
 * sampling. Sufficient for overlap math — anti-aliased downsampling
 * doesn't help when both inputs are 0/255 indicators.
 */
function resampleNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return src;
  const out = new Uint8Array(dstW * dstH);
  const xScale = srcW / dstW;
  const yScale = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * yScale));
    const srcRow = sy * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * xScale));
      out[dstRow + x] = src[srcRow + sx];
    }
  }
  return out;
}

/**
 * Compute intersection-over-union of two binary masks. If the masks are at
 * different resolutions, the second is resampled (nearest) onto the
 * first's grid.
 *
 * Returns 0 when either mask has no set pixels.
 */
export function maskIoU(a: Mask, b: Mask): number {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return 0;
  const bData = resampleNearest(b.data, b.width, b.height, a.width, a.height);
  let intersection = 0;
  let union = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const aOn = a.data[i] > 0;
    const bOn = bData[i] > 0;
    if (aOn && bOn) intersection++;
    if (aOn || bOn) union++;
  }
  return union === 0 ? 0 : intersection / union;
}

/**
 * Containment of `a` within `b`: fraction of `a`'s set pixels that are
 * also set in `b`. Useful when a SAM click selects a sub-part of a larger
 * semantic region (e.g. clicking the face inside the "subject" region).
 *
 * Returns 0 when `a` has no set pixels.
 */
export function maskContainment(a: Mask, b: Mask): number {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return 0;
  const bData = resampleNearest(b.data, b.width, b.height, a.width, a.height);
  let aOn = 0;
  let inB = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    if (a.data[i] > 0) {
      aOn++;
      if (bData[i] > 0) inB++;
    }
  }
  return aOn === 0 ? 0 : inB / aOn;
}

/**
 * Boolean OR of two masks. The result is at `a`'s resolution; `b` is
 * resampled (nearest) if its dimensions differ. Output bytes are 0 or 255.
 */
export function maskUnion(a: Mask, b: Mask): { data: Uint8Array; width: number; height: number } {
  const bData = resampleNearest(b.data, b.width, b.height, a.width, a.height);
  const n = a.width * a.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = a.data[i] > 0 || bData[i] > 0 ? 255 : 0;
  }
  return { data: out, width: a.width, height: a.height };
}

/**
 * Boolean AND-NOT of two masks (a minus b). The result is at `a`'s
 * resolution; `b` is resampled (nearest) if its dimensions differ. Output
 * bytes are 0 or 255.
 */
export function maskSubtract(a: Mask, b: Mask): { data: Uint8Array; width: number; height: number } {
  const bData = resampleNearest(b.data, b.width, b.height, a.width, a.height);
  const n = a.width * a.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = a.data[i] > 0 && bData[i] === 0 ? 255 : 0;
  }
  return { data: out, width: a.width, height: a.height };
}

export interface RegionMatch {
  label: string;
  maskRef: string;
  iou: number;
  containment: number;
  /** The reason this match was chosen, for logging. */
  matchedBy: 'iou' | 'containment';
}

/**
 * Find the best-matching region for a newly produced mask. A region wins if:
 *   - IoU >= iouThreshold (default 0.5), OR
 *   - containment >= containmentThreshold (default 0.7): the new mask is
 *     a sub-part of the region.
 *
 * Returns the candidate with the highest score (max(iou, containment))
 * among winners, or null if no region passes either threshold.
 */
export function findBestRegionMatch(
  newMask: Mask,
  candidates: Array<{ label: string; mask: Mask; maskRef: string }>,
  iouThreshold = 0.5,
  containmentThreshold = 0.7,
): RegionMatch | null {
  let best: RegionMatch | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const iou = maskIoU(newMask, c.mask);
    const containment = maskContainment(newMask, c.mask);
    const passesIou = iou >= iouThreshold;
    const passesContainment = containment >= containmentThreshold;
    if (!passesIou && !passesContainment) continue;
    const score = Math.max(iou, containment);
    if (score > bestScore) {
      bestScore = score;
      best = {
        label: c.label,
        maskRef: c.maskRef,
        iou,
        containment,
        matchedBy: passesIou ? 'iou' : 'containment',
      };
    }
  }
  return best;
}
