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

export interface SelectionSlice {
  activeScope: Scope;
  hoveredScope: Scope | null;
  cycleStack: CycleStack | null;
  focusedWidgetId: string | null;
  /** Draft mask being previewed before the user commits (SAM preview, highlight_region). */
  activeMaskRef: MaskRef | null;
  /** Mask that has been committed — persists until the user discards or creates a new layer. */
  committedMaskRef: MaskRef | null;
  /** New — Phase 1: null = whole image, non-null = maskRef of selected Object. Old fields removed at end of Phase 1. */
  activeObjectId: string | null;
  hoveredObjectId: string | null;

  setActiveScope: (scope: Scope) => void;
  setHoveredScope: (scope: Scope | null) => void;
  setActiveObjectId: (id: string | null) => void;
  setHoveredObjectId: (id: string | null) => void;
  clickAt: (imageX: number, imageY: number, candidates: string[]) => void;
  /** Select smallest mask at a point without starting a cycle (shift-click). Returns the mask id or null. */
  shiftClickAt: (imageX: number, imageY: number, candidates: string[]) => string | null;
  focusWidget: (id: string | null) => void;
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
  activeMaskRef: null,
  committedMaskRef: null,
  activeObjectId: null,
  hoveredObjectId: null,

  setActiveScope: (scope) => set((s) => {
    s.activeScope = scope;
    s.activeObjectId = scope.kind === 'mask' ? scope.mask_id : null;
  }),
  setHoveredScope: (scope) => set((s) => {
    s.hoveredScope = scope;
    s.hoveredObjectId = scope && scope.kind === 'mask' ? scope.mask_id : null;
  }),
  setActiveObjectId: (id) => set((s) => {
    s.activeObjectId = id;
    s.activeScope = id === null ? GLOBAL_SCOPE : { kind: 'mask', mask_id: id };
  }),
  setHoveredObjectId: (id) => set((s) => {
    s.hoveredObjectId = id;
    s.hoveredScope = id === null ? null : { kind: 'mask', mask_id: id };
  }),
  focusWidget: (id) => set((s) => { s.focusedWidgetId = id; }),
  clearSelection: () => set((s) => {
    s.activeScope = GLOBAL_SCOPE;
    s.hoveredScope = null;
    s.cycleStack = null;
    s.focusedWidgetId = null;
    s.activeObjectId = null;
    s.hoveredObjectId = null;
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
      s.activeObjectId = id;
      s.hoveredScope = { kind: 'mask', mask_id: id };
      s.hoveredObjectId = id;
    });
    return id;
  },

  clickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) {
      set((s) => {
        s.cycleStack = null;
        s.activeScope = GLOBAL_SCOPE;
        s.activeObjectId = null;
        s.hoveredScope = null;
        s.hoveredObjectId = null;
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
        s.activeObjectId = selMask ?? null;
        s.hoveredScope = selMask ? { kind: 'mask', mask_id: selMask } : null;
        s.hoveredObjectId = selMask ?? null;
      });
      return;
    }
    const sorted = sortByPixelCount(candidates);
    set((s) => {
      s.cycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
      s.activeScope = { kind: 'mask', mask_id: sorted[0] };
      s.activeObjectId = sorted[0];
      s.hoveredScope = { kind: 'mask', mask_id: sorted[0] };
      s.hoveredObjectId = sorted[0];
    });
  },
});
