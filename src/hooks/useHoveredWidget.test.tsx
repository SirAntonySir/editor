import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoveredWidget } from './useHoveredWidget';
import { useEditorStore } from '@/store';

describe('useHoveredWidget', () => {
  beforeEach(() => useEditorStore.getState().setHoveredWidget(null));

  it('returns null by default', () => {
    const { result } = renderHook(() => useHoveredWidget());
    expect(result.current.hoveredWidgetId).toBeNull();
  });

  it('setHoveredWidget updates the selector value', () => {
    const { result } = renderHook(() => useHoveredWidget());
    act(() => result.current.setHoveredWidget('w-2'));
    expect(result.current.hoveredWidgetId).toBe('w-2');
  });
});
