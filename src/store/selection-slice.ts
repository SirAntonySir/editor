import type { StateCreator } from 'zustand';
import type { MaskRef } from '@/types/scope';
import { maskStore } from '@/core/mask-store';

export interface CycleStack {
  originX: number;
  originY: number;
  candidates: string[];
  cursor: number;
}

export interface SelectionSlice {
  cycleStack: CycleStack | null;
  focusedWidgetId: string | null;
  /** Draft mask being previewed before the user commits (SAM preview, highlight_region). */
  activeMaskRef: MaskRef | null;
  /** Mask that has been committed — persists until the user discards or creates a new layer. */
  committedMaskRef: MaskRef | null;
  /** null = whole image, non-null = maskRef of selected Object. */
  activeObjectId: string | null;
  hoveredObjectId: string | null;
  /** Object whose right-click context menu is currently open. Keeps the
   *  hover-only mask painted while the pointer is on the menu (which clears
   *  `hoveredObjectId`) — see objectsToPaint in lib/overlay-visibility. */
  contextMenuObjectId: string | null;

  setActiveObjectId: (id: string | null) => void;
  setHoveredObjectId: (id: string | null) => void;
  setContextMenuObjectId: (id: string | null) => void;
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
  cycleStack: null,
  focusedWidgetId: null,
  activeMaskRef: null,
  committedMaskRef: null,
  activeObjectId: null,
  hoveredObjectId: null,
  contextMenuObjectId: null,

  setActiveObjectId: (id) => set((s) => { s.activeObjectId = id; }),
  setHoveredObjectId: (id) => set((s) => { s.hoveredObjectId = id; }),
  setContextMenuObjectId: (id) => set((s) => { s.contextMenuObjectId = id; }),
  focusWidget: (id) => set((s) => { s.focusedWidgetId = id; }),
  clearSelection: () => set((s) => {
    s.activeObjectId = null;
    s.hoveredObjectId = null;
    s.contextMenuObjectId = null;
    s.cycleStack = null;
    s.focusedWidgetId = null;
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
      s.activeObjectId = id;
      s.hoveredObjectId = id;
    });
    return id;
  },

  clickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) {
      set((s) => {
        s.cycleStack = null;
        s.activeObjectId = null;
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
        s.activeObjectId = selMask ?? null;
        s.hoveredObjectId = selMask ?? null;
      });
      return;
    }
    const sorted = sortByPixelCount(candidates);
    set((s) => {
      s.cycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
      s.activeObjectId = sorted[0];
      s.hoveredObjectId = sorted[0];
    });
  },
});
