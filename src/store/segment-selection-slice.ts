import { create } from 'zustand';
import { maskStore } from '@/core/mask-store';

const CYCLE_RADIUS_PX = 8;

export interface CycleStack {
  originX: number;
  originY: number;
  candidates: string[];
  cursor: number;
}

interface SegmentSelectionState {
  hoveredSegmentId: string | null;
  selectedSegmentId: string | null;
  cycleStack: CycleStack | null;
  setHovered: (id: string | null) => void;
  clickAt: (imageX: number, imageY: number, candidates: string[]) => void;
  shiftClickAt: (imageX: number, imageY: number, candidates: string[]) => string | null;
  clear: () => void;
}

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

export const useSegmentSelection = create<SegmentSelectionState>((set, get) => ({
  hoveredSegmentId: null,
  selectedSegmentId: null,
  cycleStack: null,

  setHovered: (id) => set({ hoveredSegmentId: id }),

  clickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) {
      get().clear();
      return;
    }
    const prev = get().cycleStack;
    const withinRadius = prev
      && Math.abs(prev.originX - imageX) <= CYCLE_RADIUS_PX
      && Math.abs(prev.originY - imageY) <= CYCLE_RADIUS_PX;
    if (withinRadius && prev) {
      const nextCursor = (prev.cursor + 1) % prev.candidates.length;
      const next: CycleStack = { ...prev, cursor: nextCursor };
      set({ cycleStack: next, selectedSegmentId: next.candidates[nextCursor] });
      return;
    }
    const sorted = sortByPixelCount(candidates);
    const stack: CycleStack = { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 };
    set({ cycleStack: stack, selectedSegmentId: sorted[0] });
  },

  shiftClickAt: (imageX, imageY, candidates) => {
    if (candidates.length === 0) return null;
    const sorted = sortByPixelCount(candidates);
    const id = sorted[0];
    set({
      cycleStack: { originX: imageX, originY: imageY, candidates: sorted, cursor: 0 },
      selectedSegmentId: id,
    });
    return id;
  },

  clear: () => set({ hoveredSegmentId: null, selectedSegmentId: null, cycleStack: null }),
}));
