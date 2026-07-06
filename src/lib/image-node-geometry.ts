/**
 * Pure geometry helpers for the image-node rendering pipeline.
 * No React, no store, no DOM globals other than canvas operations.
 */

export interface Crop { x: number; y: number; w: number; h: number }
export interface Rotate { angle: number; flip_h: boolean; flip_v: boolean }
export interface Transforms { rotate?: Rotate; crop?: Crop }

/** Apply the geometry pass: rotate source onto a working canvas (sized at the
 *  rotated source's bounding box), then sample the crop rect from it into the
 *  visible canvas. Crop coords are in the post-rotation-bbox frame. At angle 0
 *  the bbox equals the source dims so behaviour is identical to before.
 *
 *  This eliminates grey triangular corners: the crop is always taken from the
 *  already-rotated source, never from a region that includes empty canvas. */
export function applyGeometry(
  internal: HTMLCanvasElement,
  visible: HTMLCanvasElement,
  transforms: Transforms,
): void {
  const ctx = visible.getContext('2d');
  if (!ctx) return;

  const angleDeg = transforms.rotate?.angle ?? 0;
  const flipH = transforms.rotate?.flip_h ?? false;
  const flipV = transforms.rotate?.flip_v ?? false;
  const W = internal.width;
  const H = internal.height;
  const θ = angleDeg * Math.PI / 180;
  const absCos = Math.abs(Math.cos(θ));
  const absSin = Math.abs(Math.sin(θ));
  const bbW = W * absCos + H * absSin;
  const bbH = W * absSin + H * absCos;

  // Crop coords are in the rotated-source-bbox frame. Default = full bbox.
  const crop = transforms.crop ?? { x: 0, y: 0, w: bbW, h: bbH };

  ctx.clearRect(0, 0, visible.width, visible.height);

  // Step 1: rotate (+ flip) source onto a working canvas of bbW × bbH.
  // Source is centered; canvas extends to the rotated bbox dims.
  const working = document.createElement('canvas');
  working.width = Math.max(1, Math.round(bbW));
  working.height = Math.max(1, Math.round(bbH));
  const wCtx = working.getContext('2d');
  if (!wCtx) return;
  wCtx.translate(working.width / 2, working.height / 2);
  wCtx.rotate(θ);
  wCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  wCtx.translate(-W / 2, -H / 2);
  wCtx.drawImage(internal, 0, 0);

  // Step 2: sample the crop rect from the working canvas into the visible.
  ctx.drawImage(
    working,
    crop.x, crop.y, crop.w, crop.h,
    0, 0, visible.width, visible.height,
  );
}

const internalCache = new Map<string, HTMLCanvasElement>();
const scratchCache = new Map<string, HTMLCanvasElement>();

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

/** Composite key for the per-layer scratch caches. Each layer on an image node
 *  needs its OWN scratch canvas: at renderScale < 1 the renderer feeds the
 *  scratch to the WebGL pipeline, which skips a texture re-upload when the
 *  source object identity is unchanged and the pixels aren't dirty (a pure
 *  zoom). A single scratch per image-node gave every layer the same identity,
 *  so the top layer rendered the bottom layer's texture and vanished below the
 *  LOD threshold. Keying by (imageNodeId, layerId) restores the distinct
 *  per-layer identity that already works at renderScale === 1. */
function scratchKey(imageNodeId: string, layerId: string): string {
  return `${imageNodeId}::${layerId}`;
}

/** Returns a cached scratch canvas for the given (image-node, layer), sized at
 *  `w × h`. Used by the renderer to downscale a layer's source bitmap before
 *  feeding it to the WebGL pipeline so shaders run at the active LOD resolution
 *  instead of full source resolution. One scratch per (image-node, layer). */
export function getScratchCanvas(imageNodeId: string, layerId: string, w: number, h: number): HTMLCanvasElement {
  const key = scratchKey(imageNodeId, layerId);
  let canvas = scratchCache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    scratchCache.set(key, canvas);
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return canvas;
}

interface ScratchCacheState { source: object; w: number; h: number }
const scratchState = new Map<string, ScratchCacheState>();

/** Memoised scratch downscale: returns a canvas containing `source`
 *  drawn at `w × h`. If the (source, w, h) tuple matches the previous
 *  call for this (image-node, layer), the cached canvas is returned without a
 *  redraw — a `drawImage` of a 4 K source into the scratch canvas costs
 *  several ms and used to run every frame even when only an adjustment
 *  param moved. Caller must NOT mutate the returned canvas. */
export function getMemoisedScratchCanvas(
  imageNodeId: string,
  layerId: string,
  source: HTMLCanvasElement | OffscreenCanvas,
  w: number,
  h: number,
): HTMLCanvasElement {
  const key = scratchKey(imageNodeId, layerId);
  const canvas = getScratchCanvas(imageNodeId, layerId, w, h);
  const last = scratchState.get(key);
  if (last && last.source === (source as unknown as object) && last.w === w && last.h === h) {
    return canvas;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
  }
  scratchState.set(key, { source: source as unknown as object, w, h });
  return canvas;
}

/** Drop one entry or the whole cache. Called by `editorDocument.closeDocument()`. */
export function clearInternalCanvasCache(imageNodeId?: string): void {
  if (imageNodeId) {
    internalCache.delete(imageNodeId);
    // Scratch caches are keyed by (imageNodeId, layerId) — drop every layer's
    // entry for this node.
    const prefix = `${imageNodeId}::`;
    for (const key of scratchCache.keys()) {
      if (key.startsWith(prefix)) scratchCache.delete(key);
    }
    for (const key of scratchState.keys()) {
      if (key.startsWith(prefix)) scratchState.delete(key);
    }
  } else {
    internalCache.clear();
    scratchCache.clear();
    scratchState.clear();
  }
}

/** Effective output dimensions for the visible canvas given source dims,
 *  rotation angle, and an optional crop. Crop coords are in the
 *  post-rotation-bbox frame, so crop.w × crop.h is already the output size.
 *  When there is no crop the effective size is the rotated-source bbox dims
 *  (bbW × bbH via trig). At angle 0 bbox equals source dims — no change. */
export function computeEffectiveSize(
  source: { w: number; h: number },
  rotateAngle: number | null,
  crop: Crop | null,
): { w: number; h: number } {
  if (crop) return { w: crop.w, h: crop.h };
  if (rotateAngle == null) return { w: source.w, h: source.h };
  const θ = Math.abs(rotateAngle) * Math.PI / 180;
  const absCos = Math.abs(Math.cos(θ));
  const absSin = Math.abs(Math.sin(θ));
  return {
    w: source.w * absCos + source.h * absSin,
    h: source.w * absSin + source.h * absCos,
  };
}
