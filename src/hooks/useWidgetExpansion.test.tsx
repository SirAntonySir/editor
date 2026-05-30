import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWidgetExpansion } from './useWidgetExpansion';
import { useEditorStore } from '@/store';

describe('useWidgetExpansion', () => {
  beforeEach(() => useEditorStore.getState().collapseAllWidgets());

  it('reports false for an unknown widget id', () => {
    const { result } = renderHook(() => useWidgetExpansion('w-1'));
    expect(result.current.isExpanded).toBe(false);
  });

  it('toggle flips state and the selector returns the latest value', () => {
    const { result } = renderHook(() => useWidgetExpansion('w-1'));
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(false);
  });
});
