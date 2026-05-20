import { create } from 'zustand';
import type { MaskRef } from '@/types/scope';

/**
 * An AI chip — a user-created selection that lives in the AI panel's target
 * list. Independent from regular layers in the Layers panel; a chip can be
 * "extracted" into a real layer via an explicit action, but otherwise stays
 * lightweight (just a mask + label).
 */
export interface AiChip {
  id: string;
  label: string;
  maskRef: MaskRef;
  /** Which layer the mask was created against (so we know what pixels to
   *  show when this chip is the active target). */
  sourceLayerId: string;
  createdAt: number;
}

/** What the AI panel is currently targeting for the next prompt. */
export type AiTargetKind = 'composite' | 'layer' | 'chip';

interface AiChipsState {
  chips: AiChip[];
  activeTargetKind: AiTargetKind;
  /** For 'layer' and 'chip' kinds: the id. Empty string for 'composite'. */
  activeTargetId: string;

  addChip: (chip: AiChip) => void;
  removeChip: (id: string) => void;
  renameChip: (id: string, label: string) => void;
  setActiveTarget: (kind: AiTargetKind, id?: string) => void;
  /** Find a chip whose mask significantly overlaps a candidate one — used to
   *  short-circuit duplicate chip creation. */
  findOverlappingChip: (predicate: (chip: AiChip) => boolean) => AiChip | undefined;
  reset: () => void;
}

export const useAiChips = create<AiChipsState>((set, get) => ({
  chips: [],
  activeTargetKind: 'composite',
  activeTargetId: '',

  addChip: (chip) =>
    set((s) => ({ chips: [...s.chips, chip] })),

  removeChip: (id) =>
    set((s) => {
      const chips = s.chips.filter((c) => c.id !== id);
      // If we just removed the active chip, fall back to composite.
      if (s.activeTargetKind === 'chip' && s.activeTargetId === id) {
        return { chips, activeTargetKind: 'composite', activeTargetId: '' };
      }
      return { chips };
    }),

  renameChip: (id, label) =>
    set((s) => ({
      chips: s.chips.map((c) => (c.id === id ? { ...c, label } : c)),
    })),

  setActiveTarget: (kind, id = '') =>
    set({ activeTargetKind: kind, activeTargetId: kind === 'composite' ? '' : id }),

  findOverlappingChip: (predicate) => get().chips.find(predicate),

  reset: () =>
    set({ chips: [], activeTargetKind: 'composite', activeTargetId: '' }),
}));
