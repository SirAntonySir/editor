import type { Mask } from '@/core/mask-store';

/**
 * Extract the boundary of a binary mask as an SVG path string in
 * mask-pixel coordinates.
 *
 * The output is a collection of axis-aligned line segments tracing pixel
 * boundaries. Adjacent boundary pixel-sides are merged into a single long
 * segment so the dash pattern can visibly *march* along them rather than
 * just blink in place. Each segment is still an independent `M…L…` subpath,
 * so a full connected polyline trace (Moore-neighbour) is left for a later
 * pass if needed for fancier effects.
 */
export function maskToOutlinePathData(mask: Mask): string {
  const { width, height, data } = mask;
  if (width <= 0 || height <= 0) return '';
  const segments: string[] = [];
  const isSet = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return data[y * width + x] > 0;
  };

  // Horizontal edges: at each integer y, find maximal x-runs where the
  // pixels at (x, y) and (x, y-1) differ in masked-ness.
  for (let y = 0; y <= height; y++) {
    let runStart: number | null = null;
    for (let x = 0; x <= width; x++) {
      const inside = isSet(x, y);
      const above = isSet(x, y - 1);
      const isEdge = x < width && inside !== above;
      if (isEdge) {
        if (runStart === null) runStart = x;
      } else if (runStart !== null) {
        segments.push(`M${runStart} ${y}L${x} ${y}`);
        runStart = null;
      }
    }
  }

  // Vertical edges: at each integer x, find maximal y-runs where pixels at
  // (x, y) and (x-1, y) differ.
  for (let x = 0; x <= width; x++) {
    let runStart: number | null = null;
    for (let y = 0; y <= height; y++) {
      const inside = isSet(x, y);
      const left = isSet(x - 1, y);
      const isEdge = y < height && inside !== left;
      if (isEdge) {
        if (runStart === null) runStart = y;
      } else if (runStart !== null) {
        segments.push(`M${x} ${runStart}L${x} ${y}`);
        runStart = null;
      }
    }
  }

  return segments.join(' ');
}
