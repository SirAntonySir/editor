import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
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

  it('exposes workspaceExpandedWidgetIds and toggleWorkspaceExpanded', () => {
    const { result } = renderHook(() => useWorkspaceSelection());
    expect(result.current.workspaceExpandedWidgetIds.size).toBe(0);
    act(() => {
      result.current.toggleWorkspaceExpanded('w-1');
    });
    expect(result.current.workspaceExpandedWidgetIds.has('w-1')).toBe(true);
  });
});
