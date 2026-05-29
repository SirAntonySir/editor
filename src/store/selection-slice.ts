import type { StateCreator } from 'zustand';
import type { Scope, MaskRef } from '@/types/scope';
import { GLOBAL_SCOPE } from '@/types/scope';
import { maskStore } from '@/core/mask-store';

export interface CycleStack {
  originX: number;
  originY: number;
  candidates: string[];
  cursor: number;
}

export type PendingBind =
  | { kind: 'tool'; toolName: string }
  | { kind: 'suggestion'; widgetId: string };

export interface SelectionSlice {
  activeScope: Scope;
  hoveredScope: Scope | null;
  cycleStack: CycleStack | null;
  focusedWidgetId: string | null;
  pendingBind: PendingBind | null;
  cursor: { x: number; y: number } | null;
  /** Draft mask being previewed before the user commits (SAM preview, highlight_region). */
  activeMaskRef: MaskRef | null;
  /** Mask that has been committed — persists until the user discards or creates a new layer. */
  committedMaskRef: MaskRef | null;

  setActiveScope: (scope: Scope) => void;
  setHoveredScope: (scope: Scope | null) => void;
  clickAt: (imageX: number, imageY: number, candidates: string[]) => void;
  /** Select smallest mask at a point without starting a cycle (shift-click). Returns the mask id or null. */
  shiftClickAt: (imageX: number, imageY: number, candidates: string[]) => string | null;
  focusWidget: (id: string | null) => void;
  startToolBind: (toolName: string) => void;
  startSuggestionBind: (widgetId: string) => void;
  updateCursor: (x: number, y: number) => void;
  cancelBind: () => void;
  clearSelection: () => void;
  setActiveMask: (ref: MaskRef | null) => void;
  commitMask: () => void;
  discardCommittedMask: () => void;
}

const CYCLE_RADIUS_PX = 8;

function countSetPixels(data: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) if (data[i]) n++;
  return n;
}

function sortByPixelCount(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ma = maskStore.get(a);
    const mb = maskStore.get(b);
    const pa = ma ? countSetPixels(ma.data) : Infinity;
    const pb = mb ? countSetPixels(mb.data) : Infinity;
    return pa - pb;
  });
}

export const createSelectionSlice: StateCreator<
  SelectionSlice,
  [['zustand/immer', never]],
  []
> = (set, get) => ({
  activeScope: GLOBAL_SCOPE,
  hoveredScope: null,
  cycleStack: null,
  focusedWidgetId: null,
  pendingBind: null,
  cursor: null,
  activeMaskRef: null,
  committedMaskRef: null,

  setActiveScope: (scope) => set((s) => { s.activeScope = scope; }),
  setHoveredScope: (scope) => set((s) => { s.hoveredScope = scope; }),
  focusWidget: (id) => set((s) => { s.focusedWidgetId = id; }),
  startToolBind: (toolName) => set((s) => { s.pendingBind = { kind: 'tool', toolName }; }),
  startSuggestionBind: (widgetId) => set((s) => { s.pendingBind = { kind: 'suggestion', widgetId }; }),
  updateCursor: (x, y) => set((s) => { s.cursor = { x, y }; }),
  cancelBind: () => set((s) => { s.pendingBind = null; s.cursor = null; }),
  clearSelection: () => set((s) => {
    s.activeScope = GLOBAL_SCOPE;
    s.hoveredScope = null;
    s.cycleStack = null;
    s.focusedWidgetId = null;
    s.pendingBind = null;
    s.cursor = null;
  }),
  setActiveMask: (ref) => set((s) => { s.activeMaskRef = ref; }),
  commitMask: () => set((s) => {
    s.committedMaskRef = s.activeMaskRef;
    s.activeMaskRef = null;
  }),
  discardCommittedMask: () => set((s) => { s.committedMaskRef = null; }),

  shiftClickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) return null;
    const sorted = sortByPixelCount(candidates);
    const id = sorted[0];
    set((s) => {
      s.cycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
      s.activeScope = { kind: 'mask', mask_id: id };
      s.hoveredScope = { kind: 'mask', mask_id: id };
    });
    return id;
  },

  clickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) {
      set((s) => {
        s.cycleStack = null;
        s.activeScope = GLOBAL_SCOPE;
        s.hoveredScope = null;
      });
      return;
    }
    const prev = get().cycleStack;
    const withinRadius = prev
      && Math.abs(prev.originX - imageX) <= CYCLE_RADIUS_PX
      && Math.abs(prev.originY - imageY) <= CYCLE_RADIUS_PX;
    if (withinRadius && prev) {
      const len = prev.candidates.length + 1;
      const nextCursor = (prev.cursor + 1) % len;
      const next: CycleStack = { ...prev, cursor: nextCursor };
      const selMask = nextCursor < prev.candidates.length ? prev.candidates[nextCursor] : null;
      set((s) => {
        s.cycleStack = next;
        s.activeScope = selMask ? { kind: 'mask', mask_id: selMask } : GLOBAL_SCOPE;
        s.hoveredScope = selMask ? { kind: 'mask', mask_id: selMask } : null;
      });
      return;
    }
    const sorted = sortByPixelCount(candidates);
    set((s) => {
      s.cycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
      s.activeScope = { kind: 'mask', mask_id: sorted[0] };
      s.hoveredScope = { kind: 'mask', mask_id: sorted[0] };
    });
  },
});
