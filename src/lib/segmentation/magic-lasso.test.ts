import { describe, expect, it } from 'vitest';
import {
  bboxFromTuple,
  bboxOfPath,
  boxPrompt,
  combineMasks,
  isMaskAcceptable,
  maskOverlapFraction,
  type Bbox,
} from './magic-lasso';
import type { LassoPoint } from './lasso';
import type { DecodedMask } from './mobile-sam-types';

const SQUARE: LassoPoint[] = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.75, 0.75],
  [0.25, 0.75],
];

/** Build a mask of `w`×`h` with the given normalized rect filled to 255. */
function maskWithRect(w: number, h: number, r: Bbox): DecodedMask {
  const data = new Uint8Array(w * h);
  const cx0 = Math.round(r.x0 * w);
  const cx1 = Math.round(r.x1 * w);
  const cy0 = Math.round(r.y0 * h);
  const cy1 = Math.round(r.y1 * h);
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) data[y * w + x] = 255;
  }
  return { width: w, height: h, data };
}

describe('bboxOfPath', () => {
  it('bounds a centered square', () => {
    expect(bboxOfPath(SQUARE)).toEqual({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
  });

  it('bounds an irregular path', () => {
    const path: LassoPoint[] = [[0.1, 0.6], [0.4, 0.2], [0.8, 0.5]];
    expect(bboxOfPath(path)).toEqual({ x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.6 });
  });
});

describe('bboxFromTuple', () => {
  it('converts a normalized [x, y, w, h] tuple to corner form', () => {
    // A candidate region's bbox is [x, y, width, height]; box prompts need
    // {x0, y0, x1, y1}. x1 = x + w, y1 = y + h.
    expect(bboxFromTuple([0.25, 0.5, 0.25, 0.25])).toEqual({
      x0: 0.25,
      y0: 0.5,
      x1: 0.5,
      y1: 0.75,
    });
  });
});

describe('boxPrompt', () => {
  it('emits two corner points with SAM box labels 2 and 3', () => {
    const pts = boxPrompt({ x0: 0.25, y0: 0.3, x1: 0.75, y1: 0.8 });
    expect(pts).toEqual([
      { x: 0.25, y: 0.3, label: 2 },
      { x: 0.75, y: 0.8, label: 3 },
    ]);
  });
});

describe('isMaskAcceptable', () => {
  const bbox: Bbox = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };

  it('accepts a well-sized object mask inside the loop', () => {
    // Fills the whole bbox — a clean object snap.
    const mask = maskWithRect(64, 64, bbox);
    expect(isMaskAcceptable(mask, bbox)).toBe(true);
  });

  it('rejects an empty mask', () => {
    const mask: DecodedMask = { width: 64, height: 64, data: new Uint8Array(64 * 64) };
    expect(isMaskAcceptable(mask, bbox)).toBe(false);
  });

  it('rejects a full-frame mask (background grab)', () => {
    const mask = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(isMaskAcceptable(mask, bbox)).toBe(false);
  });

  it('rejects a sliver relative to the loop', () => {
    // A tiny blob (~6px) inside a 32×32 bbox → well under MIN_BBOX_FILL_FRAC.
    const mask = maskWithRect(64, 64, { x0: 0.25, y0: 0.25, x1: 0.35, y1: 0.27 });
    expect(isMaskAcceptable(mask, bbox)).toBe(false);
  });

  it('rejects when the bbox is degenerate (zero area)', () => {
    const mask = maskWithRect(64, 64, bbox);
    expect(isMaskAcceptable(mask, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 })).toBe(false);
  });
});

describe('maskOverlapFraction', () => {
  it('is 1 when the overlay sits fully inside the base', () => {
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
    const overlay = maskWithRect(64, 64, { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 });
    expect(maskOverlapFraction(overlay, base)).toBe(1);
  });

  it('is 0 when the overlay is fully outside the base', () => {
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 0.25, y1: 0.25 });
    const overlay = maskWithRect(64, 64, { x0: 0.5, y0: 0.5, x1: 0.75, y1: 0.75 });
    expect(maskOverlapFraction(overlay, base)).toBe(0);
  });

  it('handles half overlap across different resolutions', () => {
    // Base at 64², overlay at 32² — left half of the overlay covers base.
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 0.5, y1: 1 });
    const overlay = maskWithRect(32, 32, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
    expect(maskOverlapFraction(overlay, base)).toBeCloseTo(0.5, 1);
  });

  it('is 0 for an empty overlay', () => {
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 1, y1: 1 });
    const overlay = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(maskOverlapFraction(overlay, base)).toBe(0);
  });
});

describe('combineMasks', () => {
  const on = (m: DecodedMask, nx: number, ny: number) =>
    m.data[Math.floor(ny * m.height) * m.width + Math.floor(nx * m.width)] === 255;

  it('union adds the overlay region and keeps the base', () => {
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
    const overlay = maskWithRect(64, 64, { x0: 0.5, y0: 0.5, x1: 1, y1: 1 });
    const out = combineMasks(base, overlay, 'union');
    expect(on(out, 0.25, 0.25)).toBe(true); // base kept
    expect(on(out, 0.75, 0.75)).toBe(true); // overlay added
    expect(on(out, 0.75, 0.25)).toBe(false); // neither
  });

  it('subtract carves the overlay out of the base', () => {
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 1, y1: 1 });
    const overlay = maskWithRect(64, 64, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
    const out = combineMasks(base, overlay, 'subtract');
    expect(on(out, 0.5, 0.5)).toBe(false); // carved out
    expect(on(out, 0.1, 0.1)).toBe(true); // base kept
  });

  it('resamples an overlay of a different resolution and leaves the base untouched', () => {
    const base = maskWithRect(64, 64, { x0: 0, y0: 0, x1: 0.5, y1: 1 });
    const overlay = maskWithRect(16, 16, { x0: 0.5, y0: 0, x1: 1, y1: 1 });
    const out = combineMasks(base, overlay, 'union');
    expect(out.width).toBe(64);
    expect(out.height).toBe(64);
    expect(on(out, 0.25, 0.5)).toBe(true);
    expect(on(out, 0.75, 0.5)).toBe(true);
    // input base unchanged
    expect(on(base, 0.75, 0.5)).toBe(false);
  });
});
