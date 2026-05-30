import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDragOverride } from './useDragOverride';
import { useEditorStore } from '@/store';

describe('useDragOverride', () => {
  beforeEach(() => useEditorStore.getState().clearDragOverrides());

  it('returns undefined when no override exists', () => {
    const { result } = renderHook(() => useDragOverride('w-1'));
    expect(result.current.override).toBeUndefined();
  });

  it('set and clear round-trip', () => {
    const { result } = renderHook(() => useDragOverride('w-1'));
    act(() => result.current.set({ x: 100, y: 200 }));
    expect(result.current.override).toEqual({ x: 100, y: 200 });
    act(() => result.current.clear());
    expect(result.current.override).toBeUndefined();
  });
});
