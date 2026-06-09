import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChromeMinFloor } from './useChromeMinFloor';

// Mock @xyflow/react's useStore so we can drive the transform directly. The
// hook only reads `transform[2]` (zoom) via the selector.
let currentZoom = 1;
vi.mock('@xyflow/react', () => ({
  useStore: <T,>(selector: (s: { transform: [number, number, number] }) => T): T =>
    selector({ transform: [0, 0, currentZoom] }),
}));

afterEach(() => {
  currentZoom = 1;
});

function readAt(zoom: number, basePx: number, minPx: number): number {
  currentZoom = zoom;
  const { result } = renderHook(() => useChromeMinFloor(basePx, minPx));
  return result.current;
}

describe('useChromeMinFloor', () => {
  it('returns 1 when natural on-screen size already exceeds minPx', () => {
    expect(readAt(1.0, 24, 14)).toBe(1);
    expect(readAt(0.7, 24, 14)).toBe(1); // 24 * 0.7 = 16.8 > 14
  });

  it('returns the counter-scale needed to reach minPx when below floor', () => {
    // zoom 0.25, base 24, min 14 → natural = 6, need counter = 14/6 ≈ 2.33
    const c = readAt(0.25, 24, 14);
    expect(c).toBeGreaterThan(2.3);
    expect(c).toBeLessThan(2.4);
  });

  it('caps the counter-scale at MAX_COUNTER (4) at extreme zoom-out', () => {
    // zoom 0.02, base 24, min 14 → natural = 0.48, raw counter ≈ 29 → capped at 4
    expect(readAt(0.02, 24, 14)).toBe(4);
  });

  it('counter is exactly 1 right at the floor', () => {
    // zoom such that 24 * zoom = 14 → zoom = 14/24 ≈ 0.583
    expect(readAt(14 / 24, 24, 14)).toBe(1);
  });

  it('different basePx values rescale the threshold independently', () => {
    // tall strip (34px) needs less zoom-rescue than short strip (18px) to stay readable
    const tall = readAt(0.3, 34, 14);   // natural = 10.2 → counter ≈ 1.37
    const short = readAt(0.3, 18, 14);  // natural = 5.4  → counter ≈ 2.59
    expect(tall).toBeLessThan(short);
    expect(tall).toBeGreaterThan(1);
  });
});
