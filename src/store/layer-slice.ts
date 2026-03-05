import type { StateCreator } from 'zustand';

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft-light' | 'hard-light';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  order: number;
}

export interface LayerSlice {
  layers: Layer[];
  activeLayerId: string | null;

  addLayer: (layer: Omit<Layer, 'order'>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Omit<Layer, 'id'>>) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
}

export const createLayerSlice: StateCreator<LayerSlice, [['zustand/immer', never]], []> = (set) => ({
  layers: [],
  activeLayerId: null,

  addLayer: (layer) =>
    set((state) => {
      const order = state.layers.length;
      state.layers.push({ ...layer, order });
      state.activeLayerId = layer.id;
    }),

  removeLayer: (id) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index === -1) return;
      state.layers.splice(index, 1);
      // Re-index order
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
      if (layer) {
        Object.assign(layer, updates);
      }
    }),

  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      const [moved] = state.layers.splice(fromIndex, 1);
      state.layers.splice(toIndex, 0, moved);
      state.layers.forEach((l, i) => {
        l.order = i;
      });
    }),
});
