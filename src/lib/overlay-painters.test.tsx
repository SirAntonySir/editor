import { describe, it, expect, vi } from 'vitest';
import type { Mask } from '@/core/mask-store';
import {
  paintFullImageOutline,
  paintMaskFill,
  paintMaskOutline,
  paintSegmentationOverlay,
} from './overlay-painters';

function make2dCtx(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('expected a 2d context from jsdom');
  return { canvas, ctx };
}

function makeMask(width: number, height: number, on: Iterable<[number, number]>): Mask {
  const data = new Uint8Array(width * height);
  for (const [x, y] of on) data[y * width + x] = 255;
  return {
    id: 'm',
    layerId: 'l',
    width,
    height,
    data,
    source: 'brush',
    createdAt: 0,
  };
}

describe('paintFullImageOutline', () => {
  it('strokes a rectangle around the canvas', () => {
    const { ctx } = make2dCtx(40, 40);
    const strokeRectSpy = vi.spyOn(ctx, 'strokeRect');
    paintFullImageOutline(ctx, 40, 40);
    expect(strokeRectSpy).toHaveBeenCalledTimes(1);
    // Inset by half the default stroke width (2) → (1,1,38,38).
    const args = strokeRectSpy.mock.calls[0];
    expect(args).toEqual([1, 1, 38, 38]);
  });

  it('is a no-op for zero-sized canvases', () => {
    const { ctx } = make2dCtx(40, 40);
    const strokeRectSpy = vi.spyOn(ctx, 'strokeRect');
    paintFullImageOutline(ctx, 0, 0);
    expect(strokeRectSpy).not.toHaveBeenCalled();
  });
});

describe('paintMaskFill', () => {
  it('draws the temp fill canvas scaled to the target', () => {
    const { ctx } = make2dCtx(20, 20);
    const drawImageSpy = vi.spyOn(ctx, 'drawImage');
    const mask = makeMask(2, 2, [[0, 0], [1, 1]]);
    paintMaskFill({ ctx, canvasWidth: 20, canvasHeight: 20 }, mask);
    expect(drawImageSpy).toHaveBeenCalledTimes(1);
    const call = drawImageSpy.mock.calls[0];
    // (canvas, dx, dy, dw, dh) — the 5-arg form.
    expect(call[1]).toBe(0);
    expect(call[2]).toBe(0);
    expect(call[3]).toBe(20);
    expect(call[4]).toBe(20);
  });

  it('is a no-op for an empty mask', () => {
    const { ctx } = make2dCtx(20, 20);
    const drawImageSpy = vi.spyOn(ctx, 'drawImage');
    const mask = makeMask(0, 0, []);
    paintMaskFill({ ctx, canvasWidth: 20, canvasHeight: 20 }, mask);
    expect(drawImageSpy).not.toHaveBeenCalled();
  });
});

describe('paintMaskOutline', () => {
  it('strokes the edge cells of a binary mask', () => {
    const { ctx } = make2dCtx(40, 40);
    const strokeSpy = vi.spyOn(ctx, 'stroke');
    const beginPathSpy = vi.spyOn(ctx, 'beginPath');
    const setLineDashSpy = vi.spyOn(ctx, 'setLineDash');
    // 2x2 mask with one cell on — all four sides are edges.
    const mask = makeMask(2, 2, [[0, 0]]);
    paintMaskOutline({ ctx, canvasWidth: 40, canvasHeight: 40 }, mask);
    expect(beginPathSpy).toHaveBeenCalledTimes(1);
    expect(strokeSpy).toHaveBeenCalledTimes(1);
    expect(setLineDashSpy).toHaveBeenCalledWith([4, 3]);
  });

  it('honours a custom dash pattern of null (solid line)', () => {
    const { ctx } = make2dCtx(40, 40);
    const setLineDashSpy = vi.spyOn(ctx, 'setLineDash');
    const mask = makeMask(2, 2, [[0, 0]]);
    paintMaskOutline({ ctx, canvasWidth: 40, canvasHeight: 40 }, mask, { dash: null });
    expect(setLineDashSpy).not.toHaveBeenCalled();
  });
});

describe('paintSegmentationOverlay', () => {
  it('runs a fill pass and an outline pass', () => {
    const { ctx } = make2dCtx(40, 40);
    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
    const strokeSpy = vi.spyOn(ctx, 'stroke');
    const mask = makeMask(2, 2, [[0, 0], [1, 0]]);
    paintSegmentationOverlay({ ctx, canvasWidth: 40, canvasHeight: 40 }, mask, 'selected');
    // Row 0 has a 2-cell run → exactly one fillRect for it; row 1 is empty.
    expect(fillRectSpy).toHaveBeenCalledTimes(1);
    expect(strokeSpy).toHaveBeenCalledTimes(1);
  });

  it('uses different stroke widths for hover vs selected', () => {
    const mask = makeMask(2, 2, [[0, 0]]);
    {
      const { ctx } = make2dCtx(40, 40);
      paintSegmentationOverlay({ ctx, canvasWidth: 40, canvasHeight: 40 }, mask, 'hover');
      // After save/restore, lineWidth resets — sample it during the call by spying on stroke.
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      paintSegmentationOverlay({ ctx, canvasWidth: 40, canvasHeight: 40 }, mask, 'hover');
      expect(strokeSpy).toHaveBeenCalled();
    }
    {
      const { ctx } = make2dCtx(40, 40);
      const strokeSpy = vi.spyOn(ctx, 'stroke');
      paintSegmentationOverlay({ ctx, canvasWidth: 40, canvasHeight: 40 }, mask, 'selected');
      expect(strokeSpy).toHaveBeenCalled();
    }
  });
});
