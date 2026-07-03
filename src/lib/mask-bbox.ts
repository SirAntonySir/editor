/**
 * Compute the inclusive pixel bbox of the white (255) region in a mask.
 * Returns null when the mask is empty.
 *
 * Lives in its own DOM-free module (originally in store/segment-actions)
 * because segment-actions' module graph instantiates LayerCompositor —
 * which touches `document` at load time and crashes node-environment
 * consumers. Pure geometry consumers import from here.
 */
export function computeMaskBbox(
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
