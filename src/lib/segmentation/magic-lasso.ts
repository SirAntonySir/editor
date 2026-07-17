import type { LassoPoint } from './lasso';
import type { DecodedMask, SamPoint } from './mobile-sam-types';

/**
 * Magic-lasso helpers. The user draws a rough loop; instead of rasterizing the
 * freehand polygon (that's the plain lasso), we feed the loop's bounding box to
 * MobileSAM as a box prompt so it snaps to the one object inside. If SAM is
 * unavailable or the result looks like garbage, the caller falls back to the
 * drawn polygon — so a stroke is never wasted.
 *
 * All functions here are pure and jsdom-testable (no canvas, no ONNX).
 */

/** Axis-aligned bounds of a normalized path, in normalized [0..1] units. */
export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Reject a SAM mask that fills more than this fraction of the whole image —
 *  the model grabbed the background instead of the object. */
export const MAX_IMAGE_FILL_FRAC = 0.9;
/** Reject a SAM mask whose filled area is under this fraction of the loop's
 *  bounding box — a sliver, not the object the loop was drawn around. */
export const MIN_BBOX_FILL_FRAC = 0.02;

/** Axis-aligned bounding box of a normalized lasso path. */
export function bboxOfPath(path: readonly LassoPoint[]): Bbox {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const [x, y] of path) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Convert a normalized `[x, y, width, height]` bbox tuple (the shape a
 * `CandidateRegion` carries) into corner form. `x1 = x + w`, `y1 = y + h`.
 */
export function bboxFromTuple([x, y, w, h]: readonly [number, number, number, number]): Bbox {
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

/**
 * Encode a box as a SAM prompt: two points at the top-left and bottom-right
 * corners with SAM's box-corner labels (2 and 3). The decoder's generic
 * point_coords/point_labels path consumes these unchanged.
 */
export function boxPrompt(bbox: Bbox): SamPoint[] {
  return [
    { x: bbox.x0, y: bbox.y0, label: 2 },
    { x: bbox.x1, y: bbox.y1, label: 3 },
  ];
}

/**
 * Fraction of the overlay's "on" pixels that land inside the base mask.
 * Resolution-independent — overlay pixels are looked up in the base via
 * normalized coordinates, so a lasso raster and a SAM mask of different
 * sizes compare directly. 0 = fully outside the base, 1 = fully inside.
 */
export function maskOverlapFraction(overlay: DecodedMask, base: DecodedMask): number {
  let on = 0;
  let inside = 0;
  for (let y = 0; y < overlay.height; y++) {
    for (let x = 0; x < overlay.width; x++) {
      if (overlay.data[y * overlay.width + x] !== 255) continue;
      on++;
      const bx = Math.min(base.width - 1, Math.floor(((x + 0.5) / overlay.width) * base.width));
      const by = Math.min(base.height - 1, Math.floor(((y + 0.5) / overlay.height) * base.height));
      if (base.data[by * base.width + bx] === 255) inside++;
    }
  }
  return on === 0 ? 0 : inside / on;
}

/**
 * Boolean-combine two masks in pixel space. The result stays at the base
 * mask's resolution; the overlay is nearest-neighbour sampled via normalized
 * coordinates so masks of different sizes (SAM output vs lasso raster)
 * compose without a resize pass.
 */
export function combineMasks(
  base: DecodedMask,
  overlay: DecodedMask,
  op: 'union' | 'subtract',
): DecodedMask {
  const data = new Uint8Array(base.data);
  const value = op === 'union' ? 255 : 0;
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const ox = Math.min(overlay.width - 1, Math.floor(((x + 0.5) / base.width) * overlay.width));
      const oy = Math.min(overlay.height - 1, Math.floor(((y + 0.5) / base.height) * overlay.height));
      if (overlay.data[oy * overlay.width + ox] === 255) {
        data[y * base.width + x] = value;
      }
    }
  }
  return { data, width: base.width, height: base.height };
}

/**
 * Confidence gate for a SAM box-prompt result. Rejects masks that are empty,
 * effectively full-frame (background grab), or a sliver relative to the loop's
 * bounding box. A rejected mask tells the caller to fall back to the drawn
 * polygon.
 */
export function isMaskAcceptable(mask: DecodedMask, bbox: Bbox): boolean {
  const total = mask.width * mask.height;
  if (total === 0) return false;

  let filled = 0;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] === 255) filled++;
  }
  if (filled === 0) return false;

  // Full-frame → the model selected the background, not an object.
  if (filled / total > MAX_IMAGE_FILL_FRAC) return false;

  // Sliver relative to the loop the user drew.
  const bboxArea = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0) * total;
  if (bboxArea <= 0) return false;
  if (filled / bboxArea < MIN_BBOX_FILL_FRAC) return false;

  return true;
}
