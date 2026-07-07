/**
 * editor-state-persistence — write-through subscriber that mirrors the
 * frontend slice of `useEditorStore` (layers, document meta, and the
 * canvas-workspace graph) into IndexedDB keyed by the active sessionId.
 *
 * Reload flow restores the same shape from IDB before the canvas is
 * rendered, so layers AND the per-image-node workspace layout survive
 * Cmd+R. Without the workspace fields, two image nodes that the user
 * arranged into separate canvas tiles collapsed into a single auto-
 * created node containing the merged layer list on reload — the
 * fallback in CanvasWorkspace's auto-create effect.
 */
import { useEditorStore, type EditorState } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { putEditorState } from './pixel-source-store';

export interface PersistedEditorState {
  layers: EditorState['layers'];
  activeLayerId: EditorState['activeLayerId'];
  pixelVersion: EditorState['pixelVersion'];
  documentMeta: EditorState['documentMeta'];
  /** Canvas-workspace graph. Without these on reload the auto-create
   *  effect in CanvasWorkspace would collapse all layers into a single
   *  new node. */
  imageNodes: EditorState['imageNodes'];
  widgetNodes: EditorState['widgetNodes'];
  tetherEdges: EditorState['tetherEdges'];
  infoNodes: EditorState['infoNodes'];
  /** Standalone layers nodes (position per image node). Restored so a dragged
   *  layers node survives reload; back-filled by CanvasWorkspace otherwise. */
  layerNodes: EditorState['layerNodes'];
  activeImageNodeId: EditorState['activeImageNodeId'];
  /** Per-image-node mode (layers vs objects). Kept so the drafting
   *  surface remembers whether the user opted into objects mode. */
  imageNodeMode: EditorState['imageNodeMode'];
}

function snapshot(state: EditorState): PersistedEditorState {
  return {
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    pixelVersion: state.pixelVersion,
    documentMeta: state.documentMeta,
    imageNodes: state.imageNodes,
    widgetNodes: state.widgetNodes,
    tetherEdges: state.tetherEdges,
    infoNodes: state.infoNodes,
    layerNodes: state.layerNodes,
    activeImageNodeId: state.activeImageNodeId,
    imageNodeMode: state.imageNodeMode,
  };
}

function changed(a: PersistedEditorState, b: PersistedEditorState): boolean {
  return (
    a.layers !== b.layers ||
    a.activeLayerId !== b.activeLayerId ||
    a.pixelVersion !== b.pixelVersion ||
    a.documentMeta !== b.documentMeta ||
    a.imageNodes !== b.imageNodes ||
    a.widgetNodes !== b.widgetNodes ||
    a.tetherEdges !== b.tetherEdges ||
    a.infoNodes !== b.infoNodes ||
    a.layerNodes !== b.layerNodes ||
    a.activeImageNodeId !== b.activeImageNodeId ||
    a.imageNodeMode !== b.imageNodeMode
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
