// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeEffectiveSize, applyGeometry, getInternalCanvas, clearInternalCanvasCache } from './image-node-geometry';

describe('computeEffectiveSize', () => {
  const source = { w: 800, h: 600 };

  it('returns source dims when no rotate, no crop', () => {
    expect(computeEffectiveSize(source, null, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps source dims for 90°', () => {
    expect(computeEffectiveSize(source, 90, null)).toEqual({ w: 600, h: 800 });
  });

  it('swaps source dims for 270°', () => {
    expect(computeEffectiveSize(source, 270, null)).toEqual({ w: 600, h: 800 });
  });

  it('does not swap for 0°', () => {
    expect(computeEffectiveSize(source, 0, null)).toEqual({ w: 800, h: 600 });
  });

  it('does not swap for 180°', () => {
    expect(computeEffectiveSize(source, 180, null)).toEqual({ w: 800, h: 600 });
  });

  it('crop replaces source dims when no rotate', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 0, crop)).toEqual({ w: 600, h: 400 });
  });

  it('crop dims swap on 90°', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 90, crop)).toEqual({ w: 400, h: 600 });
  });

  it('normalises negative angle (-90 → 270 → swap)', () => {
    expect(computeEffectiveSize(source, -90, null)).toEqual({ w: 600, h: 800 });
  });

  it('does not swap for angles within 1° of 0', () => {
    expect(computeEffectiveSize(source, 0.5, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps for angles within 1° of 90', () => {
    expect(computeEffectiveSize(source, 89.5, null)).toEqual({ w: 600, h: 800 });
  });
});

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

describe('applyGeometry — identity', () => {
  it('clears the visible canvas and drawImage(internal, 0, 0)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const clearSpy = vi.spyOn(ctx, 'clearRect');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, {});

    expect(clearSpy).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(drawSpy).toHaveBeenCalledTimes(1);
    expect(drawSpy).toHaveBeenCalledWith(internal, 0, 0, 800, 600, 0, 0, 800, 600);
  });
});

describe('applyGeometry — rotation', () => {
  it('rotate-90 issues rotate(π/2) and draws full internal at source dims', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 800);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const rotateSpy = vi.spyOn(ctx, 'rotate');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { rotate: { angle: 90, flip_h: false, flip_v: false } });

    expect(rotateSpy).toHaveBeenCalledWith(Math.PI / 2);
    expect(drawSpy).toHaveBeenCalledWith(internal, 0, 0, 800, 600, 0, 0, 800, 600);
  });

  it('rotate-180 leaves visible dims at source (caller pre-sized to source)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const rotateSpy = vi.spyOn(ctx, 'rotate');

    applyGeometry(internal, visible, { rotate: { angle: 180, flip_h: false, flip_v: false } });

    expect(rotateSpy).toHaveBeenCalledWith(Math.PI);
  });

  it('rotate-270 issues rotate(3π/2)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 800);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const rotateSpy = vi.spyOn(ctx, 'rotate');

    applyGeometry(internal, visible, { rotate: { angle: 270, flip_h: false, flip_v: false } });

    expect(rotateSpy).toHaveBeenCalledWith((270 * Math.PI) / 180);
  });
});

describe('applyGeometry — flip', () => {
  it('flip-h calls scale(-1, 1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: true, flip_v: false } });

    expect(scaleSpy).toHaveBeenCalledWith(-1, 1);
  });

  it('flip-v calls scale(1, -1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: false, flip_v: true } });

    expect(scaleSpy).toHaveBeenCalledWith(1, -1);
  });

  it('flip-both calls scale(-1, -1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: true, flip_v: true } });

    expect(scaleSpy).toHaveBeenCalledWith(-1, -1);
  });
});

describe('applyGeometry — crop', () => {
  it('crop-only samples the crop rect into a same-sized visible canvas', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 400);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { crop: { x: 100, y: 50, w: 600, h: 400 } });

    expect(drawSpy).toHaveBeenCalledWith(internal, 100, 50, 600, 400, 0, 0, 600, 400);
  });

  it('crop-plus-rotate-90 keeps crop in source coords, rotates after', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(400, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');
    const rotateSpy = vi.spyOn(ctx, 'rotate');

    applyGeometry(internal, visible, {
      crop: { x: 100, y: 50, w: 600, h: 400 },
      rotate: { angle: 90, flip_h: false, flip_v: false },
    });

    expect(rotateSpy).toHaveBeenCalledWith(Math.PI / 2);
    expect(drawSpy).toHaveBeenCalledWith(internal, 100, 50, 600, 400, 0, 0, 600, 400);
  });

  it('crop-plus-flip-h samples crop, scales(-1, 1)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 400);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const scaleSpy = vi.spyOn(ctx, 'scale');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, {
      crop: { x: 100, y: 50, w: 600, h: 400 },
      rotate: { angle: 0, flip_h: true, flip_v: false },
    });

    expect(scaleSpy).toHaveBeenCalledWith(-1, 1);
    expect(drawSpy).toHaveBeenCalledWith(internal, 100, 50, 600, 400, 0, 0, 600, 400);
  });
});

describe('applyGeometry — order of operations', () => {
  it('translate-rotate-scale-translate-drawImage in that sequence', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const calls: string[] = [];
    vi.spyOn(ctx, 'setTransform').mockImplementation(() => { calls.push('setTransform'); });
    vi.spyOn(ctx, 'translate').mockImplementation(() => { calls.push('translate'); });
    vi.spyOn(ctx, 'rotate').mockImplementation(() => { calls.push('rotate'); });
    vi.spyOn(ctx, 'scale').mockImplementation(() => { calls.push('scale'); });
    vi.spyOn(ctx, 'drawImage').mockImplementation(() => { calls.push('drawImage'); });

    applyGeometry(internal, visible, {
      rotate: { angle: 90, flip_h: true, flip_v: false },
    });

    expect(calls).toEqual([
      'setTransform', 'translate', 'rotate', 'scale', 'translate', 'drawImage', 'setTransform',
    ]);
  });
});

describe('internal-canvas cache', () => {
  beforeEach(() => {
    clearInternalCanvasCache();
  });

  it('returns the same canvas instance for the same imageNodeId', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    const b = getInternalCanvas('in-1', 800, 600);
    expect(a).toBe(b);
  });

  it('resizes the cached canvas when dims change but keeps the same instance', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    const b = getInternalCanvas('in-1', 1024, 768);
    expect(a).toBe(b);
    expect(b.width).toBe(1024);
    expect(b.height).toBe(768);
  });

  it('returns different instances for different imageNodeIds', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    const b = getInternalCanvas('in-2', 800, 600);
    expect(a).not.toBe(b);
  });

  it('clearInternalCanvasCache() drops all entries', () => {
    const a = getInternalCanvas('in-1', 800, 600);
    clearInternalCanvasCache();
    const b = getInternalCanvas('in-1', 800, 600);
    expect(a).not.toBe(b);
  });

  it('clearInternalCanvasCache(id) drops only that entry', () => {
    const a1 = getInternalCanvas('in-1', 800, 600);
    const a2 = getInternalCanvas('in-2', 800, 600);
    clearInternalCanvasCache('in-1');
    const b1 = getInternalCanvas('in-1', 800, 600);
    const b2 = getInternalCanvas('in-2', 800, 600);
    expect(b1).not.toBe(a1);
    expect(b2).toBe(a2);
  });
});
