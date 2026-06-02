/**
 * Pure geometry helpers for the image-node rendering pipeline.
 * No React, no store, no DOM globals other than canvas operations.
 */

export interface Crop { x: number; y: number; w: number; h: number }
export interface Rotate { angle: number; flip_h: boolean; flip_v: boolean }
export interface Transforms { rotate?: Rotate; crop?: Crop }

/** Apply the geometry pass: clear the visible canvas and draw from `internal`
 *  applying source-coords crop + rotation (about the visible-canvas centre) +
 *  flips. Assumes the caller has sized `visible` to the effective output dims
 *  computed via `computeEffectiveSize`. */
export function applyGeometry(
  internal: HTMLCanvasElement,
  visible: HTMLCanvasElement,
  transforms: Transforms,
): void {
  const ctx = visible.getContext('2d');
  if (!ctx) return;

  const crop = transforms.crop ?? { x: 0, y: 0, w: internal.width, h: internal.height };
  const angle = transforms.rotate?.angle ?? 0;
  const flipH = transforms.rotate?.flip_h ?? false;
  const flipV = transforms.rotate?.flip_v ?? false;

  ctx.clearRect(0, 0, visible.width, visible.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(visible.width / 2, visible.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.translate(-crop.w / 2, -crop.h / 2);
  ctx.drawImage(internal, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const internalCache = new Map<string, HTMLCanvasElement>();

/** Returns a cached internal canvas for the given image-node id, sized at
 *  `w × h`. Reuses the same canvas instance across calls; resizes if dims
 *  changed. */
export function getInternalCanvas(imageNodeId: string, w: number, h: number): HTMLCanvasElement {
  let canvas = internalCache.get(imageNodeId);
  if (!canvas) {
    canvas = document.createElement('canvas');
    internalCache.set(imageNodeId, canvas);
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas;
}

/** Drop one entry or the whole cache. Called by `editorDocument.closeDocument()`. */
export function clearInternalCanvasCache(imageNodeId?: string): void {
  if (imageNodeId) internalCache.delete(imageNodeId);
  else internalCache.clear();
}

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
