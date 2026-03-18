/**
 * CropRect — Fabric.js objects for the crop selection overlay.
 *
 * Uses 4 semi-transparent Rects around the crop area (top/bottom/left/right strips)
 * instead of an evenodd Path, so coordinates stay in scene space with no transforms.
 *
 * The crop rect uses originX:'left', originY:'top' so that left/top refer to the
 * actual top-left corner, making boundary clamping straightforward.
 */

import * as fabric from 'fabric';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const OVERLAY_COLOR = 'rgba(0, 0, 0, 0.5)';
const GRID_COLOR = 'rgba(255, 255, 255, 0.3)';
const BORDER_COLOR = 'rgba(255, 255, 255, 0.85)';
const HANDLE_COLOR = '#ffffff';
const HANDLE_SIZE = 10;
const BORDER_WIDTH = 1.5;

/** Scene-space extent for overlay rects — covers any realistic viewport. */
const BIG = 100000;

/* ------------------------------------------------------------------ */
/*  Dark overlay (4 rects)                                             */
/* ------------------------------------------------------------------ */

export interface OverlayRects {
  top: fabric.Rect;
  bottom: fabric.Rect;
  left: fabric.Rect;
  right: fabric.Rect;
}

function makeOverlayRect(): fabric.Rect {
  return new fabric.Rect({
    fill: OVERLAY_COLOR,
    selectable: false,
    evented: false,
    excludeFromExport: true,
    objectCaching: false,
    originX: 'left',
    originY: 'top',
  });
}

/** Create the 4 overlay strips (add to canvas in order: top, bottom, left, right). */
export function createOverlayRects(): OverlayRects {
  return {
    top: makeOverlayRect(),
    bottom: makeOverlayRect(),
    left: makeOverlayRect(),
    right: makeOverlayRect(),
  };
}

/**
 * Reposition the 4 overlay strips so they tile around the crop area.
 *
 *   ┌────────────────────────────────────┐
 *   │              TOP                   │
 *   ├──────┬──────────────┬──────────────┤
 *   │ LEFT │  crop rect   │    RIGHT     │
 *   ├──────┴──────────────┴──────────────┤
 *   │             BOTTOM                 │
 *   └────────────────────────────────────┘
 *
 * All coordinates are in scene space.
 */
export function updateOverlayRects(
  rects: OverlayRects,
  cropLeft: number,
  cropTop: number,
  cropRight: number,
  cropBottom: number,
): void {
  // Top strip: full width, from -BIG to cropTop
  rects.top.set({ left: -BIG, top: -BIG, width: BIG * 2, height: cropTop + BIG });
  rects.top.setCoords();

  // Bottom strip: full width, from cropBottom to +BIG
  rects.bottom.set({ left: -BIG, top: cropBottom, width: BIG * 2, height: BIG - cropBottom });
  rects.bottom.setCoords();

  // Left strip: between cropTop and cropBottom, from -BIG to cropLeft
  rects.left.set({ left: -BIG, top: cropTop, width: cropLeft + BIG, height: cropBottom - cropTop });
  rects.left.setCoords();

  // Right strip: between cropTop and cropBottom, from cropRight to +BIG
  rects.right.set({ left: cropRight, top: cropTop, width: BIG - cropRight, height: cropBottom - cropTop });
  rects.right.setCoords();
}

/** Add all 4 overlay rects to a canvas (call before adding the crop rect). */
export function addOverlayToCanvas(canvas: fabric.Canvas, rects: OverlayRects): void {
  canvas.add(rects.top, rects.bottom, rects.left, rects.right);
}

/** Remove all 4 overlay rects from a canvas. */
export function removeOverlayFromCanvas(canvas: fabric.Canvas, rects: OverlayRects): void {
  canvas.remove(rects.top, rects.bottom, rects.left, rects.right);
}

/* ------------------------------------------------------------------ */
/*  Crop selection rect with grid                                      */
/* ------------------------------------------------------------------ */

/**
 * Create the crop selection rectangle.
 *
 * Uses `originX:'left', originY:'top'` so that `left`/`top` refer to the
 * actual top-left corner — all boundary math becomes trivial.
 */
export function createCropRect(
  left: number,
  top: number,
  width: number,
  height: number,
): fabric.Rect {
  const rect = new fabric.Rect({
    left,
    top,
    width,
    height,
    originX: 'left',
    originY: 'top',
    fill: 'transparent',
    stroke: BORDER_COLOR,
    strokeWidth: BORDER_WIDTH,
    strokeUniform: true,
    lockRotation: true,
    lockScalingFlip: true,        // ← prevents negative scale / mirroring
    hasRotatingPoint: false,
    cornerColor: HANDLE_COLOR,
    cornerStyle: 'rect',
    cornerSize: HANDLE_SIZE,
    transparentCorners: false,
    borderColor: 'transparent',
    minScaleLimit: 0.01,
    objectCaching: false,
    excludeFromExport: true,
  });

  rect.setControlVisible('mtr', false);

  // Custom rendering: draw rule-of-thirds grid
  const originalRender = rect._render.bind(rect);
  rect._render = function (ctx: CanvasRenderingContext2D) {
    originalRender(ctx);
    drawRuleOfThirds(ctx, this.width, this.height);
  };

  return rect;
}

/**
 * Draw a 3×3 rule-of-thirds grid inside the crop rect.
 * Called from the rect's `_render` override — ctx is translated to object center.
 */
function drawRuleOfThirds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  ctx.beginPath();

  const x0 = -width / 2;
  const y0 = -height / 2;

  // Vertical lines at 1/3, 2/3
  for (let i = 1; i <= 2; i++) {
    const x = x0 + (width * i) / 3;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + height);
  }

  // Horizontal lines at 1/3, 2/3
  for (let i = 1; i <= 2; i++) {
    const y = y0 + (height * i) / 3;
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + width, y);
  }

  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Boundary helpers (all assume originX:'left', originY:'top')        */
/* ------------------------------------------------------------------ */

/** Edges of an axis-aligned bounding box. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Get the 4 edges of a crop rect in scene coordinates. */
export function getCropEdges(cropRect: fabric.Rect): Bounds {
  const l = cropRect.left ?? 0;
  const t = cropRect.top ?? 0;
  return {
    left: l,
    top: t,
    right: l + cropRect.getScaledWidth(),
    bottom: t + cropRect.getScaledHeight(),
  };
}

/**
 * Clamp the crop rect position so it stays within the image bounds.
 * Only moves the rect — does not change its size.
 */
export function clampCropPosition(cropRect: fabric.Rect, img: Bounds): void {
  const w = cropRect.getScaledWidth();
  const h = cropRect.getScaledHeight();
  const l = cropRect.left ?? 0;
  const t = cropRect.top ?? 0;

  cropRect.set({
    left: Math.max(img.left, Math.min(l, img.right - w)),
    top: Math.max(img.top, Math.min(t, img.bottom - h)),
  });
  cropRect.setCoords();
}

/**
 * Clamp the crop rect edges after a scale so it stays within the image bounds.
 * May change both position and scale.
 */
export function clampCropScale(cropRect: fabric.Rect, img: Bounds): void {
  let l = cropRect.left ?? 0;
  let t = cropRect.top ?? 0;
  let r = l + cropRect.getScaledWidth();
  let b = t + cropRect.getScaledHeight();

  // Clamp each edge
  if (l < img.left) l = img.left;
  if (t < img.top) t = img.top;
  if (r > img.right) r = img.right;
  if (b > img.bottom) b = img.bottom;

  const newW = Math.max(r - l, 10);
  const newH = Math.max(b - t, 10);

  cropRect.set({
    left: l,
    top: t,
    scaleX: newW / (cropRect.width ?? 1),
    scaleY: newH / (cropRect.height ?? 1),
  });
  cropRect.setCoords();
}
