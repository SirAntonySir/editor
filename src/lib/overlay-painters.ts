/**
 * Overlay painters — pure 2D-canvas drawing routines used by the workspace
 * image-node renderer to overlay selection / mask / segmentation chrome on
 * top of the per-image-node composite.
 *
 * Every function is a side-effect-only `(ctx, ...) => void` that takes:
 *   - a target 2D context already sized to the canvas it paints into,
 *   - the canvas dimensions (so masks at native resolution can be scaled),
 *   - the data needed for that one pass (mask data, colours, etc).
 *
 * No React, no Fabric, no store reads — callers pass in what they need.
 * This keeps the painters trivially unit-testable and lets the workspace
 * and Fabric paths share the underlying drawing math without coupling.
 *
 * The Fabric branch keeps its own (slightly more elaborate) overlay
 * machinery in `src/components/canvas/*` because it relies on Fabric
 * object transforms / events; this module is the de-coupled equivalent
 * for the workspace branch. Both are wired to the same `maskStore`
 * single-source-of-truth — only the rendering medium differs. The
 * Fabric copy disappears at T20.
 */

import type { Mask } from '@/core/mask-store';

/** Drawing context for painters that scale mask data into the canvas. */
export interface OverlayPainterContext {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
}

/** Default colours match the Fabric overlay aesthetic. */
const DEFAULTS = {
  /** Blue accent for full-image outline and committed selection. */
  accent: 'rgba(0, 113, 227, 1)',
  /** Translucent blue selection fill. */
  selectionFill: 'rgba(10, 132, 255, 0.12)',
  /** Translucent blue hover fill. */
  hoverFill: 'rgba(10, 132, 255, 0.08)',
  /** Mask fill HSL (matches Fabric "active" pink). */
  maskFillHsl: [310, 90, 60] as [number, number, number],
  /** Outline stroke colour for committed masks. */
  outlineStroke: 'rgba(255, 255, 255, 0.95)',
} as const;

/* -------------------------------------------------------------------------- */
/* Full-image outline                                                         */
/* -------------------------------------------------------------------------- */

export interface PaintFullImageOutlineOptions {
  /** Stroke colour (default: blue accent). */
  color?: string;
  /** Stroke width in CSS px (default: 2). */
  width?: number;
}

/**
 * Paints a hairline rectangle around the entire canvas — mirrors the
 * `FullImageOutline.tsx` blue accent used in the Fabric branch when the
 * active scope is `global`.
 */
export function paintFullImageOutline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  options: PaintFullImageOutlineOptions = {},
): void {
  const { color = DEFAULTS.accent, width = 2 } = options;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  // strokeRect is centred on the path — inset by half the stroke so the
  // outline sits fully inside the canvas bounds.
  const inset = width / 2;
  ctx.strokeRect(inset, inset, w - width, h - width);
  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/* Mask fill (translucent overlay on selected / committed regions)            */
/* -------------------------------------------------------------------------- */

export interface PaintMaskFillOptions {
  /** Fill colour as HSL triple (default: pink, matches Fabric "active" state). */
  fillHsl?: [number, number, number];
  /** Final alpha multiplier 0..1 (default 0.45 — matches Fabric default). */
  alpha?: number;
}

/**
 * Paints a translucent mask fill scaled to the canvas. Mirrors
 * `buildMaskFillCanvas` from `useFabricOverlays.ts` — pixels with mask
 * value 0 are transparent, the rest are the same coloured fill.
 */
export function paintMaskFill(
  painter: OverlayPainterContext,
  mask: Mask,
  options: PaintMaskFillOptions = {},
): void {
  const { ctx, canvasWidth, canvasHeight } = painter;
  if (mask.width <= 0 || mask.height <= 0) return;
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  const { fillHsl = DEFAULTS.maskFillHsl, alpha = 0.45 } = options;
  const tmp = document.createElement('canvas');
  tmp.width = mask.width;
  tmp.height = mask.height;
  const tmpCtx = tmp.getContext('2d');
  if (!tmpCtx) return;
  const img = tmpCtx.createImageData(mask.width, mask.height);
  const [h, s, l] = fillHsl;
  const { r, g, b } = hslToRgb(h, s, l);
  for (let i = 0; i < mask.data.length; i++) {
    const a = mask.data[i];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(a * alpha);
  }
  tmpCtx.putImageData(img, 0, 0);
  ctx.save();
  ctx.drawImage(tmp, 0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/* Mask outline (committed marching-ants edge)                                */
/* -------------------------------------------------------------------------- */

export interface PaintMaskOutlineOptions {
  /** Stroke colour (default: white). */
  color?: string;
  /** Stroke width in canvas px (default 1.25). */
  width?: number;
  /** Dash pattern. `null` for a solid line. */
  dash?: number[] | null;
}

/**
 * Paints a 1px outline tracing the boundary of a binary mask. Uses an
 * edge-cell pass equivalent to `SegmentOverlay`'s outline pass: for every
 * set pixel we draw the edge of any side that borders an unset pixel.
 *
 * The Fabric branch uses `maskToOutlinePathData` + an SVG path for the
 * marching-ants animation; we draw the same geometry directly into the
 * 2D context here because the workspace canvas is re-painted on every
 * snapshot change, which is plenty for this pass.
 */
export function paintMaskOutline(
  painter: OverlayPainterContext,
  mask: Mask,
  options: PaintMaskOutlineOptions = {},
): void {
  const { ctx, canvasWidth, canvasHeight } = painter;
  if (mask.width <= 0 || mask.height <= 0) return;
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  const {
    color = DEFAULTS.outlineStroke,
    width = 1.25,
    dash = [4, 3],
  } = options;

  const cellW = canvasWidth / mask.width;
  const cellH = canvasHeight / mask.height;

  ctx.save();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  if (dash && dash.length > 0) ctx.setLineDash(dash);
  ctx.beginPath();
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const on = mask.data[y * mask.width + x] !== 0;
      if (!on) continue;
      const up = y > 0 && mask.data[(y - 1) * mask.width + x];
      const dn = y < mask.height - 1 && mask.data[(y + 1) * mask.width + x];
      const lt = x > 0 && mask.data[y * mask.width + x - 1];
      const rt = x < mask.width - 1 && mask.data[y * mask.width + x + 1];
      const px = x * cellW;
      const py = y * cellH;
      if (!up) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + cellW, py);
      }
      if (!dn) {
        ctx.moveTo(px, py + cellH);
        ctx.lineTo(px + cellW, py + cellH);
      }
      if (!lt) {
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + cellH);
      }
      if (!rt) {
        ctx.moveTo(px + cellW, py);
        ctx.lineTo(px + cellW, py + cellH);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/* Segmentation overlay (hover + selected)                                    */
/* -------------------------------------------------------------------------- */

export type SegmentOutlineStyle = 'hover' | 'selected';

/**
 * Paints the segmentation overlay — a translucent fill plus an edge-cell
 * outline. Ports the inner `drawOutline` loop from `SegmentOverlay.tsx`,
 * minus the Fabric viewport transform / image-bounds math (the workspace
 * canvas is already in image-pixel space).
 */
export function paintSegmentationOverlay(
  painter: OverlayPainterContext,
  mask: Mask,
  style: SegmentOutlineStyle,
): void {
  const { ctx, canvasWidth, canvasHeight } = painter;
  if (mask.width <= 0 || mask.height <= 0) return;
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  const cellW = canvasWidth / mask.width;
  const cellH = canvasHeight / mask.height;

  ctx.save();
  ctx.lineWidth = style === 'selected' ? 2.5 : 1.5;
  ctx.strokeStyle =
    style === 'selected' ? 'rgba(10, 132, 255, 1)' : 'rgba(10, 132, 255, 0.55)';
  ctx.fillStyle =
    style === 'selected' ? DEFAULTS.selectionFill : DEFAULTS.hoverFill;

  // Fill pass — scan-line runs of set pixels.
  for (let y = 0; y < mask.height; y++) {
    let runStart = -1;
    for (let x = 0; x < mask.width; x++) {
      const on = mask.data[y * mask.width + x] !== 0;
      if (on && runStart < 0) runStart = x;
      if ((!on || x === mask.width - 1) && runStart >= 0) {
        const xEnd = on ? x + 1 : x;
        ctx.fillRect(runStart * cellW, y * cellH, (xEnd - runStart) * cellW, cellH);
        runStart = -1;
      }
    }
  }

  // Outline pass — edge cells only.
  ctx.beginPath();
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const on = mask.data[y * mask.width + x] !== 0;
      if (!on) continue;
      const up = y > 0 && mask.data[(y - 1) * mask.width + x];
      const dn = y < mask.height - 1 && mask.data[(y + 1) * mask.width + x];
      const lt = x > 0 && mask.data[y * mask.width + x - 1];
      const rt = x < mask.width - 1 && mask.data[y * mask.width + x + 1];
      const px = x * cellW;
      const py = y * cellH;
      if (!up) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + cellW, py);
      }
      if (!dn) {
        ctx.moveTo(px, py + cellH);
        ctx.lineTo(px + cellW, py + cellH);
      }
      if (!lt) {
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + cellH);
      }
      if (!rt) {
        ctx.moveTo(px + cellW, py);
        ctx.lineTo(px + cellW, py + cellH);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/* HSL → RGB helper (single-shot, used by mask fill)                          */
/* -------------------------------------------------------------------------- */

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}
