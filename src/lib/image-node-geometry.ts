/**
 * Pure geometry helpers for the image-node rendering pipeline.
 * No React, no store, no DOM globals other than canvas operations.
 */

export interface Crop { x: number; y: number; w: number; h: number }
export interface Rotate { angle: number; flip_h: boolean; flip_v: boolean }
export interface Transforms { rotate?: Rotate; crop?: Crop }

/** Effective output dimensions for the visible canvas given source dims,
 *  rotation angle, and an optional source-coords crop. Rotation by 90°/270°
 *  swaps the effective width and height; 0° / 180° do not. Flip never swaps.
 *  Crop reduces dims to the crop rect's `w` / `h` before the swap. */
export function computeEffectiveSize(
  source: { w: number; h: number },
  rotateAngle: number | null,
  crop: Crop | null,
): { w: number; h: number } {
  const baseW = crop ? crop.w : source.w;
  const baseH = crop ? crop.h : source.h;
  if (rotateAngle == null) return { w: baseW, h: baseH };
  const a = ((rotateAngle % 360) + 360) % 360;
  const swap = Math.abs(a - 90) < 1 || Math.abs(a - 270) < 1;
  return swap ? { w: baseH, h: baseW } : { w: baseW, h: baseH };
}
