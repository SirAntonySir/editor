import { useEditorStore } from '@/store';
import { CanvasRegistry } from './canvas-registry';

export function revertToOriginal() {
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
}
