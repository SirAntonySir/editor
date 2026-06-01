import { describe, expect, it } from 'vitest';
import { pickTetherHandles } from './tether-handles';

describe('pickTetherHandles', () => {
  it('widget far to the LEFT of the image → outlet on widget right, image left', () => {
    // image at x=1000..3000, widget centre at x=100
    const { sourceHandle, targetHandle } = pickTetherHandles(100, 1000, 3000);
    expect(sourceHandle).toBe('tether-out-right');
    expect(targetHandle).toBe('tether-in-left');
  });

  it('widget far to the RIGHT of the image → outlet on widget left, image right', () => {
    // image at x=0..1000, widget centre at x=2000
    const { sourceHandle, targetHandle } = pickTetherHandles(2000, 0, 1000);
    expect(sourceHandle).toBe('tether-out-left');
    expect(targetHandle).toBe('tether-in-right');
  });

  it('widget inside image left half → both handles use image left edge', () => {
    // image x=0..2000 (wide), widget centre x=400 (well inside image left half).
    // Old centre-vs-centre logic picked widget right + image left → edge looped
    // back across the widget body. New logic exits widget on its LEFT facing
    // the image's left edge.
    const { sourceHandle, targetHandle } = pickTetherHandles(400, 0, 2000);
    expect(sourceHandle).toBe('tether-out-left');
    expect(targetHandle).toBe('tether-in-left');
  });

  it('widget inside image right half → both handles use image right edge', () => {
    const { sourceHandle, targetHandle } = pickTetherHandles(1600, 0, 2000);
    expect(sourceHandle).toBe('tether-out-right');
    expect(targetHandle).toBe('tether-in-right');
  });

  it('widget centred over image → ties break to LEFT edge (deterministic)', () => {
    const { sourceHandle, targetHandle } = pickTetherHandles(1000, 0, 2000);
    expect(targetHandle).toBe('tether-in-left');
    // Widget is right of image's left edge → outlet faces left edge.
    expect(sourceHandle).toBe('tether-out-left');
  });
});
