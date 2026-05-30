import { useEditorStore } from '@/store';

/**
 * Selector hook over the workspace slice's selection-related state.
 * React Flow owns transient multi-select; the slice mirrors the
 * currently-active ImageNode (derived in CanvasWorkspace.onSelectionChange)
 * and the expanded-widget set.
 */
export function useWorkspaceSelection() {
  return {
    activeImageNodeId: useEditorStore((s) => s.activeImageNodeId),
    workspaceExpandedWidgetIds: useEditorStore((s) => s.workspaceExpandedWidgetIds),
    setActiveImageNode: useEditorStore((s) => s.setActiveImageNode),
    toggleWorkspaceExpanded: useEditorStore((s) => s.toggleWorkspaceExpanded),
  };
}
