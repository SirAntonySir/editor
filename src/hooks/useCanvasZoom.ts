import { useCallback } from 'react';
import { useEditorStore } from '@/store';

/**
 * Canvas-zoom controls for the workspace.
 *
 * The workspace uses React Flow's built-in zoom/pan, which is internal to
 * the `<ReactFlow>` instance. These hooks dispatch DOM events that the
 * `CanvasWorkspace` listens for and applies via `useReactFlow()`.
 *
 * For status-bar parity we also mirror the requested zoom into the
 * editor-store so the percentage display reflects the menu action.
 */
function dispatch(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function useCanvasZoom() {
  const applyZoom = useCallback((newZoom: number) => {
    const clamped = Math.max(0.1, Math.min(32, newZoom));
    useEditorStore.getState().setZoom(clamped);
    dispatch('workspace:zoom', { zoom: clamped });
  }, []);

  const fitOnScreen = useCallback(() => {
    useEditorStore.getState().setFitMode('fit');
    dispatch('workspace:fit-view');
  }, []);

  const zoomIn = useCallback(() => {
    dispatch('workspace:zoom-in');
  }, []);

  const zoomOut = useCallback(() => {
    dispatch('workspace:zoom-out');
  }, []);

  return { applyZoom, fitOnScreen, zoomIn, zoomOut };
}
