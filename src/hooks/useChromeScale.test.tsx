import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useChromeScale } from './useChromeScale';

function wrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe('useChromeScale (deprecated stub)', () => {
  it('always returns 1 regardless of canvas zoom', () => {
    const { result } = renderHook(() => useChromeScale(), { wrapper });
    expect(result.current).toBe(1);
  });

  it('returns 1 with no ReactFlowProvider context', () => {
    // The stub is independent of the store.
    const { result } = renderHook(() => useChromeScale());
    expect(result.current).toBe(1);
  });
});
