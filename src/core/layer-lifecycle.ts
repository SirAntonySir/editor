/**
 * LayerLifecycle — subscribes to the Zustand store and automatically
 * keeps PixelStore in sync when layers are added or removed.
 *
 * This removes the need for manual pixelStore.remove() calls scattered
 * throughout the codebase. The store slice stays pure (no side effects).
 */
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import type { Layer } from '@/store/layer-slice';

let prevLayerIds = new Set<string>();

/**
 * Call once during app init (after store is created).
 * Returns an unsubscribe function.
 */
export function initLayerLifecycle(): () => void {
  // Seed with current layers
  const initial = useEditorStore.getState().layers;
  prevLayerIds = new Set(initial.map((l) => l.id));

  return useEditorStore.subscribe((state) => {
    const currentIds = new Set(state.layers.map((l: Layer) => l.id));

    // Detect removed layers → clean up pixel data
    for (const id of prevLayerIds) {
      if (!currentIds.has(id)) {
        pixelStore.remove(id);
      }
    }

    prevLayerIds = currentIds;
  });
}
