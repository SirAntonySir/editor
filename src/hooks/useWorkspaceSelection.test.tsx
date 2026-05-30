import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  useEditorStore.getState().collapseAllWidgets();
});

describe('useWorkspaceSelection', () => {
  it('returns the activeImageNodeId after setActiveImageNode', () => {
    const { result } = renderHook(() => useWorkspaceSelection());
    expect(result.current.activeImageNodeId).toBeNull();
    act(() => {
      const id = useEditorStore.getState().addImageNode(['l-1']);
      useEditorStore.getState().setActiveImageNode(id);
    });
    expect(result.current.activeImageNodeId).not.toBeNull();
  });

  it('exposes expandedWidgetIds and toggleWidgetExpanded', () => {
    const { result } = renderHook(() => useWorkspaceSelection());
    expect(result.current.expandedWidgetIds.size).toBe(0);
    act(() => {
      result.current.toggleWidgetExpanded('w-1');
    });
    expect(result.current.expandedWidgetIds.has('w-1')).toBe(true);
  });
});
