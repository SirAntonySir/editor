import { describe, expect, it } from 'vitest';
import { pickTetherHandles, layerHandleForSide } from './tether-handles';

describe('layerHandleForSide', () => {
  it('keeps the base id for the left side, suffixes the others', () => {
    expect(layerHandleForSide('L1', 'tether-in-left')).toBe('layer-tether-L1');
    expect(layerHandleForSide('L1', 'tether-in-top')).toBe('layer-tether-L1@top');
    expect(layerHandleForSide('L1', 'tether-in-right')).toBe('layer-tether-L1@right');
    expect(layerHandleForSide('L1', 'tether-in-bottom')).toBe('layer-tether-L1@bottom');
  });
});

// Image bounds used across cases: x0..x1 = 0..2000, y0..y1 = 1000..2000.
const img = { x0: 0, y0: 1000, x1: 2000, y1: 2000 };

describe('pickTetherHandles (four-way)', () => {
  it('widget far to the LEFT (same vertical band) → image left, widget right', () => {
    const widget = { x: -800, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-left');
    expect(p.sourceHandle).toBe('tether-out-right');
  });

  it('widget far to the RIGHT (same vertical band) → image right, widget left', () => {
    const widget = { x: 2800, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-right');
    expect(p.sourceHandle).toBe('tether-out-left');
  });

  it('widget far ABOVE (same horizontal band) → image top, widget bottom', () => {
    const widget = { x: 1000, y: 200 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-top');
    expect(p.sourceHandle).toBe('tether-out-bottom');
  });

  it('widget far BELOW (same horizontal band) → image bottom, widget top', () => {
    const widget = { x: 1000, y: 2800 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-bottom');
    expect(p.sourceHandle).toBe('tether-out-top');
  });

  it('widget inside image left half (vertically inside too) → both use LEFT', () => {
    const widget = { x: 400, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-left');
    expect(p.sourceHandle).toBe('tether-out-left');
  });

  it('widget inside image right half (vertically inside too) → both use RIGHT', () => {
    const widget = { x: 1600, y: 1500 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-right');
    expect(p.sourceHandle).toBe('tether-out-right');
  });

  it('diagonal: widget top-LEFT of image → horizontal distance wins when smaller', () => {
    // Widget at (-100, 950): horizontal distance to left edge = 100,
    // vertical distance to top edge = 50 → vertical axis is closer.
    const widget = { x: -100, y: 950 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-top');
    expect(p.sourceHandle).toBe('tether-out-bottom');
  });

  it('diagonal: widget bottom-RIGHT, horizontal axis closer', () => {
    // Widget at (2050, 2200): horizontal 50, vertical 200 → horizontal wins.
    const widget = { x: 2050, y: 2200 };
    const p = pickTetherHandles(widget, img);
    expect(p.targetHandle).toBe('tether-in-right');
    expect(p.sourceHandle).toBe('tether-out-left');
  });
});
