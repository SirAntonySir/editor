import type { Mask } from '@/core/mask-store';

/**
 * Centroid (geometric mean) of a binary mask's set pixels, in mask-pixel
 * coordinates. Returns `null` when the mask is empty. Used to anchor
 * overlay text labels at a meaningful location.
 *
 * Caveat: for masks with disconnected components, the centroid can land
 * between them. Adequate for single-object SAM clicks; not adequate for
 * stylised "everything-but-background" selections. Upgrade to a
 * largest-component centroid later if needed.
 */
export function maskCentroid(mask: Mask): { x: number; y: number } | null {
  const { width, height, data } = mask;
  if (width <= 0 || height <= 0) return null;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > 0) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}
