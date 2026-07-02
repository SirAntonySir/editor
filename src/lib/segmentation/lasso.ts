import type { DecodedMask } from './mobile-sam-types';

/** One lasso vertex in normalized image space (0..1 on both axes). */
export type LassoPoint = [number, number];

/**
 * Minimum polygon area (as a fraction of the image) below which a lasso is
 * treated as an accidental click and discarded. 0.0001 ≈ a 1%×1% box.
 */
export const MIN_LASSO_AREA_FRAC = 0.0001;

/** True when `p` is far enough from the path's last point to be worth
 *  keeping. `minDistNorm` is in normalized units (caller converts from
 *  screen px). Keeps hand-drawn paths light without visible corner loss. */
export function shouldAppendPoint(
  path: readonly LassoPoint[],
  p: LassoPoint,
  minDistNorm: number,
): boolean {
  const last = path[path.length - 1];
  if (!last) return true;
  const dx = p[0] - last[0];
  const dy = p[1] - last[1];
  return dx * dx + dy * dy >= minDistNorm * minDistNorm;
}

/** Signed shoelace area of a closed polygon in normalized units. */
export function polygonAreaFrac(path: readonly LassoPoint[]): number {
  if (path.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < path.length; i++) {
    const [x1, y1] = path[i];
    const [x2, y2] = path[(i + 1) % path.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Rasterize a closed normalized polygon into the same `DecodedMask` shape SAM
 * produces (Uint8Array of 0/255), so the existing candidate → propose_mask →
 * maskStore pipeline consumes it unchanged. Pure scanline even-odd fill — no
 * canvas, so it runs (and is tested) in jsdom.
 *
 * Returns null for degenerate paths: fewer than 3 points or area under
 * `minAreaFrac` of the image.
 */
export function rasterizeLassoPath(
  path: readonly LassoPoint[],
  width: number,
  height: number,
  minAreaFrac: number = MIN_LASSO_AREA_FRAC,
): DecodedMask | null {
  if (path.length < 3) return null;
  if (polygonAreaFrac(path) < minAreaFrac) return null;

  const data = new Uint8Array(width * height);
  const n = path.length;
  const xs: number[] = [];

  for (let row = 0; row < height; row++) {
    const sy = (row + 0.5) / height; // scanline through the pixel-row centre
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = path[i];
      const [x2, y2] = path[(i + 1) % n];
      // Half-open interval [min, max) so a vertex exactly on the scanline
      // counts once, not twice (the classic even-odd corner bug).
      if ((y1 <= sy) === (y2 <= sy)) continue;
      xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] * width - 0.5));
      const to = Math.min(width - 1, Math.floor(xs[k + 1] * width - 0.5));
      for (let col = from; col <= to; col++) data[row * width + col] = 255;
    }
  }
  return { width, height, data };
}

/** Pick raster dimensions for a lasso mask: the image's natural size, capped
 *  at `maxEdge` on the long edge (a hand-drawn outline gains nothing from
 *  full-resolution rasters, and the PNG ships over the wire). */
export function lassoRasterSize(
  naturalW: number,
  naturalH: number,
  maxEdge: number = 1024,
): { width: number; height: number } {
  const long = Math.max(naturalW, naturalH);
  if (long <= maxEdge) return { width: Math.max(1, naturalW), height: Math.max(1, naturalH) };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(naturalW * scale)),
    height: Math.max(1, Math.round(naturalH * scale)),
  };
}
