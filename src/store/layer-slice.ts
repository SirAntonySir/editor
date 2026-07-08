import type { StateCreator } from 'zustand';
import type { MaskRef } from '@/types/scope';
import type { BlendMode } from '@/types/adjustment';

export type { BlendMode } from '@/types/adjustment';
export type LayerType = string;

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  order: number;
  /** Non-destructive branching — references the parent layer ID. */
  parentLayerId?: string;
  /** Alpha mask applied at composite time. */
  layerMask?: MaskRef;
  /** For layers extracted from a parent's masked region: pixel-space origin
   *  in the source layer where the cutout came from. Lets us re-insert the
   *  cutout back into the original at the right offset. Absent for normal
   *  (non-extracted) layers. */
  sourceOrigin?: { x: number; y: number };
}

export interface LayerSlice {
  layers: Layer[];
  activeLayerId: string | null;
  pixelVersion: number;
  /** One-shot flag: non-null while an inline-rename is pending for this layer id. */
  renamingLayerId: string | null;

  addLayer: (layer: Omit<Layer, 'order'>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Omit<Layer, 'id'>>) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  requestRenameLayer: (id: string) => void;
  clearRenameRequest: () => void;

  revertAll: () => void;
  bumpPixelVersion: () => void;
}

export const createLayerSlice: StateCreator<LayerSlice, [['zustand/immer', never]], []> = (set) => ({
  layers: [],
  activeLayerId: null,
  pixelVersion: 0,
  renamingLayerId: null,

  addLayer: (layer) =>
    set((state) => {
      if (layer.parentLayerId && !state.layers.some((l) => l.id === layer.parentLayerId)) {
        throw new Error(`addLayer: parentLayerId "${layer.parentLayerId}" does not exist`);
      }
      const order = state.layers.length;
      state.layers.push({ ...layer, order });
      state.activeLayerId = layer.id;
    }),

  removeLayer: (id) =>
    set((state) => {
      const hasChildren = state.layers.some((l) => l.parentLayerId === id);
      if (hasChildren) throw new Error(`removeLayer: layer "${id}" has child layers — remove children first`);
      const index = state.layers.findIndex((l) => l.id === id);
      if (index === -1) return;
      state.layers.splice(index, 1);
      state.layers.forEach((l, i) => {
        l.order = i;
      });
      if (state.activeLayerId === id) {
        state.activeLayerId = state.layers[0]?.id ?? null;
      }
    }),

  setActiveLayer: (id) =>
    set((state) => {
      state.activeLayerId = id;
      // Keep the active image node in lock-step with the active layer: the
      // inspector preview renders `[activeLayerId]` in isolation while the
      // canvas renders each node by its own `layerIds`, so if the two drift an
      // edit shows in the preview but not on the selected canvas image. When
      // the selected layer belongs to a known node, adopt that node. A layer
      // that belongs to no node yet (the mid-duplicate window, before its node
      // is created) leaves the active node untouched rather than clobbering it.
      if (id) {
        // `imageNodes` / `activeImageNodeId` live on the workspace slice; at
        // runtime `state` is the full composed store, so they're present.
        const ws = state as unknown as {
          imageNodes: Record<string, { id: string; layerIds: string[] }>;
          activeImageNodeId: string | null;
        };
        const owner = Object.values(ws.imageNodes).find((n) => n.layerIds.includes(id));
        if (owner) ws.activeImageNodeId = owner.id;
      }
    }),

  updateLayer: (id, updates) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === id);
      if (!layer) return;
      if ('parentLayerId' in updates && updates.parentLayerId !== undefined) {
        // Walk the proposed parent chain to detect cycles.
        let cursor: string | undefined = updates.parentLayerId;
        const seen = new Set<string>();
        while (cursor) {
          if (cursor === id) throw new Error(`updateLayer: parentLayerId would create a cycle (${id})`);
          if (seen.has(cursor)) break;
          seen.add(cursor);
          cursor = state.layers.find((l) => l.id === cursor)?.parentLayerId;
        }
      }
      Object.assign(layer, updates);
    }),

  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      const [moved] = state.layers.splice(fromIndex, 1);
      state.layers.splice(toIndex, 0, moved);
      state.layers.forEach((l, i) => {
        l.order = i;
      });
    }),

  requestRenameLayer: (id) =>
    set((state) => {
      state.renamingLayerId = id;
    }),

  clearRenameRequest: () =>
    set((state) => {
      state.renamingLayerId = null;
    }),

  revertAll: () =>
    set((state) => {
      // Remove all non-image layers (pixel cleanup handled by caller)
      state.layers = state.layers.filter((l) => l.type === 'image');
      // Reset active layer
      state.activeLayerId = state.layers[0]?.id ?? null;
      // Reorder
      state.layers.forEach((l, i) => { l.order = i; });
      state.pixelVersion += 1;
    }),

  bumpPixelVersion: () =>
    set((state) => {
      state.pixelVersion += 1;
    }),
});
