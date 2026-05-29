/**
 * editor-state-persistence — write-through subscriber that mirrors the
 * frontend slice of `useEditorStore` (layers, activeLayerId, pixelVersion,
 * documentMeta) into IndexedDB keyed by the active sessionId.
 *
 * Reload flow restores the same shape from IDB before the canvas is
 * rendered, so the layer list and document dimensions survive Cmd+R.
 */
import { useEditorStore, type EditorState } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { putEditorState } from './pixel-source-store';

export interface PersistedEditorState {
  layers: EditorState['layers'];
  activeLayerId: EditorState['activeLayerId'];
  pixelVersion: EditorState['pixelVersion'];
  documentMeta: EditorState['documentMeta'];
}

function snapshot(state: EditorState): PersistedEditorState {
  return {
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    pixelVersion: state.pixelVersion,
    documentMeta: state.documentMeta,
  };
}

function changed(a: PersistedEditorState, b: PersistedEditorState): boolean {
  return (
    a.layers !== b.layers ||
    a.activeLayerId !== b.activeLayerId ||
    a.pixelVersion !== b.pixelVersion ||
    a.documentMeta !== b.documentMeta
  );
}

export function initEditorStatePersistence(): () => void {
  let prev = snapshot(useEditorStore.getState());
  return useEditorStore.subscribe((state) => {
    const next = snapshot(state);
    if (!changed(prev, next)) return;
    prev = next;
    const sid = useBackendState.getState().sessionId;
    if (!sid) return;
    void putEditorState(sid, next);
  });
}
