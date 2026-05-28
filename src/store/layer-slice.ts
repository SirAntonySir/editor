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
}

export interface LayerSlice {
  layers: Layer[];
  activeLayerId: string | null;
  pixelVersion: number;

  addLayer: (layer: Omit<Layer, 'order'>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Omit<Layer, 'id'>>) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;

  revertAll: () => void;
  bumpPixelVersion: () => void;
}

export const createLayerSlice: StateCreator<LayerSlice, [['zustand/immer', never]], []> = (set) => ({
  layers: [],
  activeLayerId: null,
  pixelVersion: 0,

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
