import { describe, it, expect } from 'vitest';
import { exceedsDragThreshold, isOutsideRect, rejoinTargetByCenter, nextWidgetScale } from './workspace-drag';

describe('exceedsDragThreshold', () => {
  it('is false for a tiny move (a click, not a drag)', () => {
    expect(exceedsDragThreshold(2, 2, 4)).toBe(false);
  });
  it('is true once the move passes the threshold', () => {
    expect(exceedsDragThreshold(5, 0, 4)).toBe(true);
    expect(exceedsDragThreshold(3, 3, 4)).toBe(true); // hypot ≈ 4.24
  });
});

describe('isOutsideRect', () => {
  const rect = { position: { x: 0, y: 0 }, size: { w: 100, h: 80 } };
  it('is false for a point inside the source bounds (cancel)', () => {
    expect(isOutsideRect({ x: 50, y: 40 }, rect)).toBe(false);
  });
  it('is true for a point past any edge (extract)', () => {
    expect(isOutsideRect({ x: 120, y: 40 }, rect)).toBe(true); // right
    expect(isOutsideRect({ x: 50, y: -5 }, rect)).toBe(true);  // above
    expect(isOutsideRect({ x: -1, y: 40 }, rect)).toBe(true);  // left
  });
});

describe('nextWidgetScale', () => {
  it('keeps the start scale when there is no drag', () => {
    expect(nextWidgetScale(200, 1, 0)).toBe(1);
  });
  it('grows the scale as the bottom-right corner is dragged out', () => {
    // natural 200 at scale 1 → width 200; +100 → 300/200 = 1.5.
    expect(nextWidgetScale(200, 1, 100)).toBeCloseTo(1.5);
  });
  it('shrinks as it is dragged in', () => {
    expect(nextWidgetScale(200, 1, -40)).toBeCloseTo(0.8);
  });
  it('clamps to the min and max', () => {
    expect(nextWidgetScale(200, 1, -1000, 0.7, 2.5)).toBe(0.7);
    expect(nextWidgetScale(200, 1, 1000, 0.7, 2.5)).toBe(2.5);
  });
  it('is a no-op for a zero-width widget', () => {
    expect(nextWidgetScale(0, 1.3, 100)).toBe(1.3);
  });
});

describe('rejoinTargetByCenter', () => {
  const source = { position: { x: 0, y: 0 }, size: { w: 100, h: 100 } };
  // Dragged node 40×40; center = position + 20.
  const draggedAt = (x: number, y: number) => ({ position: { x, y }, size: { w: 40, h: 40 } });

  it('returns the source id when the dragged center is over the source', () => {
    expect(rejoinTargetByCenter('src-1', draggedAt(30, 30), source)).toBe('src-1'); // center 50,50
  });
  it('returns null when the dragged center is off the source (edge touch only)', () => {
    // position 90,90 → center 110,110, outside the 100×100 source though boxes still overlap.
    expect(rejoinTargetByCenter('src-1', draggedAt(90, 90), source)).toBeNull();
  });
  it('returns null with no source or unknown source rect', () => {
    expect(rejoinTargetByCenter(undefined, draggedAt(30, 30), source)).toBeNull();
    expect(rejoinTargetByCenter('src-1', draggedAt(30, 30), undefined)).toBeNull();
  });
});
