import type { StateCreator } from 'zustand';
import type { MaskRef, Scope } from '@/types/scope';

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft-light' | 'hard-light';
export type LayerType = string;

/**
 * Provenance metadata for adjustments that were materialized from an
 * accepted AI widget. The widget itself is gone post-accept; this tag
 * lets the UI surface "AI" provenance and the user trace back.
 */
export interface AiSource {
  widgetId: string;      // originating widget id (for log/trace)
  intent: string;        // human label, e.g. "Warm skin"
  reasoning?: string;    // optional Claude reasoning
  acceptedAt: string;    // ISO 8601 timestamp
}

export interface Adjustment {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  params: Record<string, number | Float32Array>;
  /** Scope of this adjustment — defaults to global when absent. */
  scope?: Scope;
  /** Provenance metadata if accepted from an AI widget. */
  aiSource?: AiSource;
}

export interface AdjustmentStack {
  adjustments: Adjustment[];
}

export interface TextMeta {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  fontWeight: string;
  fontStyle: string;
  x: number;
  y: number;
}

/** Non-destructive crop parameters — stored per-layer so re-entering crop mode restores the selection. */
export interface CropMeta {
  /** Crop rect as fraction of the full original image (0–1, rotation-independent). */
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  /** Rotation/flip that was applied when cropping. */
  baseRotation: number;
  straighten: number;
  flipX: boolean;
  flipY: boolean;
}

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  order: number;
  adjustmentStack: AdjustmentStack;
  textMeta?: TextMeta;
  cropMeta?: CropMeta;
  /** Non-destructive branching — references the parent layer ID. */
  parentLayerId?: string;
  /** Alpha mask applied at composite time. */
  layerMask?: MaskRef;
}

const ADJUSTMENT_NAMES: Record<string, string> = {
  basic: 'Light & Color',
  curves: 'Curves',
  levels: 'Levels',
  kelvin: 'White Balance',
  lut: 'Filter',
};

export interface LayerSlice {
  layers: Layer[];
  activeLayerId: string | null;
  pixelVersion: number;

  addLayer: (layer: Omit<Layer, 'order' | 'adjustmentStack'>) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayer: (id: string, updates: Partial<Omit<Layer, 'id'>>) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;

  // Singleton adjustment (finds by type, creates if missing)
  setAdjustment: (layerId: string, type: string, params: Partial<Adjustment['params']>) => void;
  // Add a new adjustment layer (for LUTs and stackable adjustments)
  addAdjustment: (layerId: string, adjustment: Adjustment) => void;
  // Insert a new adjustment layer at a specific index
  insertAdjustment: (layerId: string, adjustment: Adjustment, atIndex: number) => void;
  // Remove an adjustment layer by ID
  removeAdjustment: (layerId: string, adjustmentId: string) => void;
  // Update adjustment layer metadata by ID
  updateAdjustmentMeta: (
    layerId: string,
    adjustmentId: string,
    updates: Partial<Pick<Adjustment, 'blendMode' | 'opacity' | 'enabled' | 'name'>>,
  ) => void;
  // Replace an adjustment's params map by ID
  updateAdjustmentParams: (
    layerId: string,
    adjustmentId: string,
    params: Record<string, number | Float32Array>,
  ) => void;
  // Toggle by type (for singleton adjustments)
  toggleAdjustment: (layerId: string, type: string, enabled: boolean) => void;
  // Reorder adjustment layers
  reorderAdjustments: (layerId: string, fromIndex: number, toIndex: number) => void;

  setActiveScope: (scope: Scope | null) => void;

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
      state.layers.push({ ...layer, order, adjustmentStack: { adjustments: [] } });
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

  setAdjustment: (layerId, type, params) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const existing = layer.adjustmentStack.adjustments.find((a) => a.type === type);
      if (existing) {
        Object.assign(existing.params, params);
      } else {
        layer.adjustmentStack.adjustments.push({
          id: crypto.randomUUID(),
          type,
          name: ADJUSTMENT_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1),
          enabled: true,
          blendMode: 'normal',
          opacity: 1,
          params: { ...params } as Record<string, number | Float32Array>,
        });
      }
    }),

  addAdjustment: (layerId, adjustment) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const s = state as LayerSlice & { activeScope: Scope | null };
      // Respect the incoming scope. activeScope is a default for tool-initiated
      // adjustments; explicit-scope adjustments (e.g. materialized AI widgets)
      // keep what they were given.
      const scoped = adjustment.scope ? adjustment : (s.activeScope ? { ...adjustment, scope: s.activeScope } : adjustment);
      layer.adjustmentStack.adjustments.push(scoped);
      s.activeScope = null;
    }),

  insertAdjustment: (layerId, adjustment, atIndex) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const s = state as LayerSlice & { activeScope: Scope | null };
      // Respect the incoming scope. activeScope is a default for tool-initiated
      // adjustments; explicit-scope adjustments (e.g. materialized AI widgets)
      // keep what they were given.
      const scoped = adjustment.scope ? adjustment : (s.activeScope ? { ...adjustment, scope: s.activeScope } : adjustment);
      const arr = layer.adjustmentStack.adjustments;
      const clamped = Math.max(0, Math.min(atIndex, arr.length));
      arr.splice(clamped, 0, scoped);
      s.activeScope = null;
    }),

  removeAdjustment: (layerId, adjustmentId) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const idx = layer.adjustmentStack.adjustments.findIndex((a) => a.id === adjustmentId);
      if (idx !== -1) {
        layer.adjustmentStack.adjustments.splice(idx, 1);
      }
    }),

  updateAdjustmentMeta: (layerId, adjustmentId, updates) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const adj = layer.adjustmentStack.adjustments.find((a) => a.id === adjustmentId);
      if (adj) {
        Object.assign(adj, updates);
      }
    }),

  updateAdjustmentParams: (layerId, adjustmentId, params) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const adj = layer.adjustmentStack.adjustments.find((a) => a.id === adjustmentId);
      if (adj) {
        adj.params = params;
      }
    }),

  toggleAdjustment: (layerId, type, enabled) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const adj = layer.adjustmentStack.adjustments.find((a) => a.type === type);
      if (adj) {
        adj.enabled = enabled;
      }
    }),

  reorderAdjustments: (layerId, fromIndex, toIndex) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const arr = layer.adjustmentStack.adjustments;
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
    }),

  setActiveScope: (scope) =>
    set((state) => {
      const s = state as LayerSlice & { activeScope: Scope | null };
      s.activeScope = scope;
    }),

  revertAll: () =>
    set((state) => {
      // Remove all non-image layers (pixel cleanup handled by caller)
      state.layers = state.layers.filter((l) => l.type === 'image');
      // Clear all adjustment stacks and crop metadata on remaining layers
      for (const layer of state.layers) {
        layer.adjustmentStack.adjustments = [];
        layer.cropMeta = undefined;
      }
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
