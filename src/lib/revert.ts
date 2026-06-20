import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CanvasRegistry } from './canvas-registry';
import { editorDocument } from '@/core/document';
import { backendTools } from './backend-tools';

/** Reset the workspace to its pre-edit baseline.
 *
 *  Two stacks compose here:
 *   - Backend: clears the canonical/widget/mask history → emits a single
 *     history.applied SSE event that swaps the snapshot in one shot.
 *   - Frontend: clears working canvases + adjustment layers (workspace
 *     state the backend doesn't track).
 *
 *  Backend revert is fire-and-forget — the SSE round-trip updates the
 *  store. We don't await it before clearing the frontend bits so the
 *  user gets immediate visual feedback. Failures log but don't block.
 */
export function revertToOriginal() {
  const sessionId = useBackendState.getState().sessionId;
  if (sessionId) {
    backendTools.revertAll(sessionId).catch((err) => {
      console.warn('[revert] backend revertAll failed:', err);
    });
  }
  editorDocument.recordSnapshot('Revert to Original', () => {
    const state = useEditorStore.getState();
    // Reset all image layers' working canvases back to source
    for (const layer of state.layers) {
      if (layer.type === 'image') {
        CanvasRegistry.resetToSource(layer.id);
      } else {
        CanvasRegistry.remove(layer.id);
      }
    }
    state.revertAll();
  });
}
