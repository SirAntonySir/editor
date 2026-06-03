// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeEffectiveSize, applyGeometry, getInternalCanvas, clearInternalCanvasCache } from './image-node-geometry';

describe('computeEffectiveSize', () => {
  const source = { w: 800, h: 600 };

  it('returns source dims when no rotate, no crop', () => {
    expect(computeEffectiveSize(source, null, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps source dims for 90° (via bbox trig: cos90=0, sin90=1)', () => {
    const r = computeEffectiveSize(source, 90, null);
    expect(r.w).toBeCloseTo(600, 5);
    expect(r.h).toBeCloseTo(800, 5);
  });

  it('swaps source dims for 270° (via bbox trig)', () => {
    const r = computeEffectiveSize(source, 270, null);
    expect(r.w).toBeCloseTo(600, 5);
    expect(r.h).toBeCloseTo(800, 5);
  });

  it('does not swap for 0°', () => {
    expect(computeEffectiveSize(source, 0, null)).toEqual({ w: 800, h: 600 });
  });

  it('does not swap for 180°', () => {
    const r = computeEffectiveSize(source, 180, null);
    // cos(180)=-1 → absCos=1, sin(180)=0 → absSin=0
    expect(r.w).toBeCloseTo(800, 5);
    expect(r.h).toBeCloseTo(600, 5);
  });

  it('crop replaces source dims when no rotate', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 0, crop)).toEqual({ w: 600, h: 400 });
  });

  it('crop dims returned directly (post-rotation frame) for 90°', () => {
    // Crop is already in bbox frame, so w/h are returned as-is.
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 90, crop)).toEqual({ w: 600, h: 400 });
  });

  it('normalises negative angle (-90 → same bbox as 90)', () => {
    const r = computeEffectiveSize(source, -90, null);
    expect(r.w).toBeCloseTo(600, 5);
    expect(r.h).toBeCloseTo(800, 5);
  });

  it('returns bbox dims for small angles (not identity)', () => {
    // At 0.5° the bbox is slightly larger than the source.
    const r = computeEffectiveSize(source, 0.5, null);
    // bbW = 800*cos(0.5°) + 600*sin(0.5°) ≈ 805.2
    // bbH = 800*sin(0.5°) + 600*cos(0.5°) ≈ 606.96
    expect(r.w).toBeGreaterThan(800);
    expect(r.h).toBeGreaterThan(600);
  });

  it('returns bbox dims for angles near 90° (bbox swaps, not identity)', () => {
    const r = computeEffectiveSize(source, 89.5, null);
    // Near-90° → w ≈ 606, h ≈ 805 (swapped and slightly inflated)
    expect(r.w).toBeGreaterThan(600);
    expect(r.h).toBeGreaterThan(800);
  });
});

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

describe('applyGeometry — identity', () => {
  it('clears the visible canvas and drawImage from working canvas into visible', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const clearSpy = vi.spyOn(ctx, 'clearRect');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, {});

    expect(clearSpy).toHaveBeenCalledWith(0, 0, 800, 600);
    // Step 2: visible ctx receives exactly one drawImage (from working canvas
    // into visible). At angle 0 bbox = source (800×600 → working 800×600).
    // Crop defaults to full bbox {x:0,y:0,w:800,h:600}.
    expect(drawSpy).toHaveBeenCalledTimes(1);
    // The first arg is the working canvas (HTMLCanvasElement), not `internal`.
    const call = drawSpy.mock.calls[0];
    expect(call[1]).toBe(0);     // sx
    expect(call[2]).toBe(0);     // sy
    expect(call[3]).toBeCloseTo(800, 1); // sw (bbW at 0°)
    expect(call[4]).toBeCloseTo(600, 1); // sh (bbH at 0°)
    expect(call[5]).toBe(0);     // dx
    expect(call[6]).toBe(0);     // dy
    expect(call[7]).toBe(800);   // dw
    expect(call[8]).toBe(600);   // dh
  });
});

describe('applyGeometry — rotation', () => {
  it('rotate-90: working canvas has bbox dims 600×800 (swapped)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 800);
    // Spy on document.createElement to capture the working canvas
    const origCreate = document.createElement.bind(document);
    let workingCanvas: HTMLCanvasElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas' && workingCanvas === null) workingCanvas = el as HTMLCanvasElement;
      return el;
    });

    applyGeometry(internal, visible, { rotate: { angle: 90, flip_h: false, flip_v: false } });

    vi.restoreAllMocks();
    // The working canvas should be 600×800 (bbox of a 800×600 source rotated 90°)
    expect(workingCanvas).not.toBeNull();
    expect(workingCanvas!.width).toBeCloseTo(600, 0);
    expect(workingCanvas!.height).toBeCloseTo(800, 0);
  });

  it('rotate-180: working canvas has same dims as source (180° bbox = source dims)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const origCreate = document.createElement.bind(document);
    let workingCanvas: HTMLCanvasElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas' && workingCanvas === null) workingCanvas = el as HTMLCanvasElement;
      return el;
    });

    applyGeometry(internal, visible, { rotate: { angle: 180, flip_h: false, flip_v: false } });

    vi.restoreAllMocks();
    expect(workingCanvas).not.toBeNull();
    expect(workingCanvas!.width).toBeCloseTo(800, 0);
    expect(workingCanvas!.height).toBeCloseTo(600, 0);
  });

  it('rotate-270: working canvas has bbox dims 600×800', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 800);
    const origCreate = document.createElement.bind(document);
    let workingCanvas: HTMLCanvasElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas' && workingCanvas === null) workingCanvas = el as HTMLCanvasElement;
      return el;
    });

    applyGeometry(internal, visible, { rotate: { angle: 270, flip_h: false, flip_v: false } });

    vi.restoreAllMocks();
    expect(workingCanvas).not.toBeNull();
    expect(workingCanvas!.width).toBeCloseTo(600, 0);
    expect(workingCanvas!.height).toBeCloseTo(800, 0);
  });
});

describe('applyGeometry — flip', () => {
  // The flip transformations happen on the working canvas (Step 1). In JSDOM
  // we can't easily spy on a freshly-created canvas's 2d context before the
  // implementation retrieves it, so these tests verify the observable effect:
  // the order-of-operations test (below) checks the full call sequence on a
  // spied working canvas; here we check that applyGeometry completes without
  // error and that the visible canvas receives exactly one drawImage call.

  it('flip-h: visible ctx receives one drawImage (no throw)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: true, flip_v: false } });

    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it('flip-v: visible ctx receives one drawImage (no throw)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: false, flip_v: true } });

    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it('flip-both: visible ctx receives one drawImage (no throw)', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, { rotate: { angle: 0, flip_h: true, flip_v: true } });

    expect(drawSpy).toHaveBeenCalledTimes(1);
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

    // At angle=0 bbox=source. The crop rect is sampled from the working canvas
    // (which has the same pixels as internal at 0°).
    expect(drawSpy).toHaveBeenCalledTimes(1);
    const call = drawSpy.mock.calls[0];
    expect(call[1]).toBe(100); // sx
    expect(call[2]).toBe(50);  // sy
    expect(call[3]).toBe(600); // sw
    expect(call[4]).toBe(400); // sh
    expect(call[5]).toBe(0);   // dx
    expect(call[6]).toBe(0);   // dy
    expect(call[7]).toBe(600); // dw (visible.width)
    expect(call[8]).toBe(400); // dh (visible.height)
  });

  it('crop-plus-rotate: working canvas is sized to the rotated bbox', () => {
    // Crop is now in post-rotation-bbox coords.
    const internal = makeCanvas(800, 600);
    // At 90°: bbox is 600×800
    const visible = makeCanvas(300, 200);
    const origCreate = document.createElement.bind(document);
    let workingCanvas: HTMLCanvasElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas' && workingCanvas === null) workingCanvas = el as HTMLCanvasElement;
      return el;
    });

    applyGeometry(internal, visible, {
      crop: { x: 50, y: 100, w: 300, h: 200 }, // in bbox frame (600×800)
      rotate: { angle: 90, flip_h: false, flip_v: false },
    });

    vi.restoreAllMocks();
    // Working canvas should be 600×800 (bbox of 800×600 rotated 90°)
    expect(workingCanvas!.width).toBeCloseTo(600, 0);
    expect(workingCanvas!.height).toBeCloseTo(800, 0);
  });

  it('crop-plus-flip-h: visible ctx receives one drawImage with crop coords', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(600, 400);
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    applyGeometry(internal, visible, {
      crop: { x: 100, y: 50, w: 600, h: 400 },
      rotate: { angle: 0, flip_h: true, flip_v: false },
    });

    expect(drawSpy).toHaveBeenCalledTimes(1);
    const call = drawSpy.mock.calls[0];
    // Step 2: visible ctx samples crop rect from working canvas
    expect(call[1]).toBe(100); // sx
    expect(call[2]).toBe(50);  // sy
  });
});

describe('applyGeometry — order of operations', () => {
  it('two-step: working canvas gets translate/rotate/scale/translate/drawImage; visible ctx gets clearRect/drawImage', () => {
    const internal = makeCanvas(800, 600);
    const visible = makeCanvas(800, 600);
    const visibleCtx = visible.getContext('2d');
    if (!visibleCtx) throw new Error('expected a 2d context');

    const visibleCalls: string[] = [];
    vi.spyOn(visibleCtx, 'clearRect').mockImplementation(() => { visibleCalls.push('clearRect'); });
    vi.spyOn(visibleCtx, 'drawImage').mockImplementation(() => { visibleCalls.push('drawImage'); });

    const origCreate = document.createElement.bind(document);
    const workingCalls: string[] = [];
    let workingCanvas: HTMLCanvasElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas' && workingCanvas === null) {
        workingCanvas = el as HTMLCanvasElement;
        const origGetCtx = workingCanvas.getContext.bind(workingCanvas);
        (workingCanvas as HTMLCanvasElement).getContext = function (type: string) {
          const ctx = origGetCtx(type as '2d');
          if (ctx && type === '2d') {
            vi.spyOn(ctx, 'translate').mockImplementation(() => { workingCalls.push('translate'); });
            vi.spyOn(ctx, 'rotate').mockImplementation(() => { workingCalls.push('rotate'); });
            vi.spyOn(ctx, 'scale').mockImplementation(() => { workingCalls.push('scale'); });
            vi.spyOn(ctx, 'drawImage').mockImplementation(() => { workingCalls.push('drawImage'); });
          }
          return ctx;
        } as typeof workingCanvas.getContext;
      }
      return el;
    });

    applyGeometry(internal, visible, {
      rotate: { angle: 90, flip_h: true, flip_v: false },
    });

    vi.restoreAllMocks();

    // Step 1 (working canvas): translate → rotate → scale → translate → drawImage
    expect(workingCalls).toEqual(['translate', 'rotate', 'scale', 'translate', 'drawImage']);
    // Step 2 (visible canvas): clearRect → drawImage
    expect(visibleCalls).toEqual(['clearRect', 'drawImage']);
  });
});

describe('applyGeometry — rotate-then-crop (no grey corners)', () => {
  it('rotate 30° with inscribed crop fills visible canvas with source colour (no grey corners)', () => {
    const internal = makeCanvas(800, 600);
    const internalCtx = internal.getContext('2d')!;
    internalCtx.fillStyle = '#ff0000';
    internalCtx.fillRect(0, 0, 800, 600);

    const θDeg = 30;
    const θ = θDeg * Math.PI / 180;
    const absCos = Math.abs(Math.cos(θ));
    const absSin = Math.abs(Math.sin(θ));
    const bbW = 800 * absCos + 600 * absSin;
    const bbH = 800 * absSin + 600 * absCos;
    const ratio = 800 / 600;
    // Inscribed rect dims (same as largestInsetRect math):
    const h = Math.min(800 / (ratio * absCos + absSin), 600 / (ratio * absSin + absCos));
    const w = h * ratio;
    const cropX = (bbW - w) / 2;
    const cropY = (bbH - h) / 2;

    const visible = makeCanvas(Math.round(w), Math.round(h));
    applyGeometry(internal, visible, {
      rotate: { angle: θDeg, flip_h: false, flip_v: false },
      crop: { x: cropX, y: cropY, w, h },
    });

    // All four corners of visible should be red (source colour), not grey/transparent.
    const ctx = visible.getContext('2d')!;
    const corners: [number, number][] = [
      [0, 0],
      [visible.width - 1, 0],
      [0, visible.height - 1],
      [visible.width - 1, visible.height - 1],
    ];
    for (const [x, y] of corners) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      expect(px[0]).toBeGreaterThan(200); // red channel
      expect(px[3]).toBeGreaterThan(200); // alpha
    }
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
