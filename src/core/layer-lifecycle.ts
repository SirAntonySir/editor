/**
 * LayerLifecycle — subscribes to the Zustand store and automatically
 * keeps PixelStore in sync when layers are added or removed.
 *
 * This removes the need for manual pixelStore.remove() calls scattered
 * throughout the codebase. The store slice stays pure (no side effects).
 *
 * It also cascades segment/mask cleanup: masks are keyed by `layerId`, so when
 * a layer goes (including when an image node is deleted from the canvas and its
 * exclusive layers are removed), the masks bound to it are dropped from the
 * registry too — locally and on the backend.
 */
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import { hiBitStore } from './hibit-store';
import { deleteOne } from './pixel-source-store';
import { maskStore } from './mask-store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
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
    const sid = useBackendState.getState().sessionId;

    // Snapshot the removed ids and advance prevLayerIds BEFORE running side
    // effects: pushMaskDeleted clears activeObjectId, which re-enters this
    // subscriber — advancing first makes that re-entry a no-op.
    const removedLayerIds: string[] = [];
    for (const id of prevLayerIds) {
      if (!currentIds.has(id)) removedLayerIds.push(id);
    }
    prevLayerIds = currentIds;

    for (const id of removedLayerIds) {
      // Pixel data + persisted source.
      pixelStore.remove(id);
      hiBitStore.remove(id);
      if (sid) void deleteOne(sid, id);

      // Segments/masks bound to this layer → drop from the registry. Collect
      // first (pushMaskDeleted mutates maskStore), then delete each: locally
      // (maskStore + ownership + snapshot.masksIndex + activeObjectId) and on
      // the backend so a later snapshot refresh can't resurrect them.
      const maskIds = maskStore.allForLayer(id).map((m) => m.id);
      for (const maskId of maskIds) {
        useBackendState.getState().pushMaskDeleted(maskId);
        if (sid) void backendTools.delete_mask(sid, { maskId });
      }
    }
  });
}
