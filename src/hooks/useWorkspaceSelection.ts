import { useEditorStore } from '@/store';

/**
 * Selector hook over the workspace slice's selection-related state.
 * React Flow owns transient multi-select; the slice mirrors the
 * currently-active ImageNode (derived in CanvasWorkspace.onSelectionChange)
 * and the expanded-widget set lives in the tool slice.
 */
export function useWorkspaceSelection() {
  return {
    activeImageNodeId: useEditorStore((s) => s.activeImageNodeId),
    expandedWidgetIds: useEditorStore((s) => s.expandedWidgetIds),
    setActiveImageNode: useEditorStore((s) => s.setActiveImageNode),
    toggleWidgetExpanded: useEditorStore((s) => s.toggleWidgetExpanded),
  };
}
