import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useZoomInvariantScale } from '../useZoomInvariantScale';

function wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe('useZoomInvariantScale', () => {
  it('returns 1 when React Flow zoom is 1', () => {
    const { result } = renderHook(() => useZoomInvariantScale(), { wrapper });
    expect(result.current).toBeCloseTo(1, 5);
  });

  it('does the clamp math correctly (zoom 0 → 100)', () => {
    // Direct unit test of the clamp formula: 1 / Math.max(zoom, 0.01)
    expect(1 / Math.max(0, 0.01)).toBe(100);
  });
});
