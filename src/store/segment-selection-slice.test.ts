import { describe, it, expect, beforeEach } from 'vitest';
import { useSegmentSelection } from './segment-selection-slice';
import { maskStore } from '@/core/mask-store';

function registerMask(label: string, pixelCount: number): string {
  const data = new Uint8Array(16);
  for (let i = 0; i < pixelCount; i++) data[i] = 1;
  return maskStore.register({
    layerId: 'l1', label, width: 4, height: 4, data,
    source: 'sam-point', createdAt: Date.now(),
  });
}

beforeEach(() => {
  maskStore.clear();
  useSegmentSelection.getState().clear();
});

describe('segment-selection slice', () => {
  it('setHovered updates hoveredSegmentId', () => {
    useSegmentSelection.getState().setHovered('m1');
    expect(useSegmentSelection.getState().hoveredSegmentId).toBe('m1');
  });

  it('clickAt builds cycle stack sorted smallest-first', () => {
    const big = registerMask('big', 8);
    const small = registerMask('small', 2);
    useSegmentSelection.getState().clickAt(0, 0, [big, small]);
    const stack = useSegmentSelection.getState().cycleStack;
    expect(stack).not.toBeNull();
    expect(stack!.candidates[0]).toBe(small);
    expect(stack!.candidates[1]).toBe(big);
    expect(useSegmentSelection.getState().selectedSegmentId).toBe(small);
  });

  it('clickAt within ±8px cycles smallest → larger → full-image (null) → wrap', () => {
    const big = registerMask('big', 8);
    const small = registerMask('small', 2);
    useSegmentSelection.getState().clickAt(100, 100, [big, small]);
    expect(useSegmentSelection.getState().selectedSegmentId).toBe(small);
    useSegmentSelection.getState().clickAt(104, 102, [big, small]);
    expect(useSegmentSelection.getState().selectedSegmentId).toBe(big);
    useSegmentSelection.getState().clickAt(103, 101, [big, small]);
    expect(useSegmentSelection.getState().selectedSegmentId).toBeNull(); // full image
    useSegmentSelection.getState().clickAt(102, 102, [big, small]);
    expect(useSegmentSelection.getState().selectedSegmentId).toBe(small); // wrap
  });

  it('clickAt outside ±8px rebuilds the cycle', () => {
    const big = registerMask('big', 8);
    const small = registerMask('small', 2);
    useSegmentSelection.getState().clickAt(100, 100, [big, small]);
    useSegmentSelection.getState().clickAt(200, 200, [big, small]);
    expect(useSegmentSelection.getState().selectedSegmentId).toBe(small);
    expect(useSegmentSelection.getState().cycleStack!.cursor).toBe(0);
  });

  it('clickAt with empty candidates clears', () => {
    const small = registerMask('only', 2);
    useSegmentSelection.getState().clickAt(0, 0, [small]);
    useSegmentSelection.getState().clickAt(0, 0, []);
    expect(useSegmentSelection.getState().selectedSegmentId).toBeNull();
  });

  it('shiftClickAt returns mask id and selects smallest', () => {
    const big = registerMask('big', 8);
    const small = registerMask('small', 2);
    const id = useSegmentSelection.getState().shiftClickAt(0, 0, [big, small]);
    expect(id).toBe(small);
    expect(useSegmentSelection.getState().selectedSegmentId).toBe(small);
  });

  it('clear resets everything', () => {
    const small = registerMask('only', 2);
    useSegmentSelection.getState().clickAt(0, 0, [small]);
    useSegmentSelection.getState().clear();
    expect(useSegmentSelection.getState().selectedSegmentId).toBeNull();
    expect(useSegmentSelection.getState().cycleStack).toBeNull();
  });
});
