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

/** Tagged key for the selection set so chips and layers coexist. Composite
 *  (whole image) is implicit when the set is empty — never has a key. */
export type TargetKey = `chip:${string}` | `layer:${string}`;

export function chipKey(id: string): TargetKey {
  return `chip:${id}`;
}
export function layerKey(id: string): TargetKey {
  return `layer:${id}`;
}

interface AiChipsState {
  chips: AiChip[];
  /** Selected targets. Empty set = composite. */
  selectedTargets: Set<TargetKey>;

  addChip: (chip: AiChip) => void;
  removeChip: (id: string) => void;
  renameChip: (id: string, label: string) => void;
  toggleTarget: (key: TargetKey) => void;
  selectTarget: (key: TargetKey) => void;
  clearTargets: () => void;
  /** Generate a label unique against existing chips by suffixing `(2)`,
   *  `(3)`, ... so every chip is unambiguously @-mentionable. */
  uniqueLabel: (base: string) => string;
  findOverlappingChip: (predicate: (chip: AiChip) => boolean) => AiChip | undefined;
  reset: () => void;
}

export const useAiChips = create<AiChipsState>((set, get) => ({
  chips: [],
  selectedTargets: new Set<TargetKey>(),

  addChip: (chip) =>
    set((s) => ({ chips: [...s.chips, chip] })),

  removeChip: (id) =>
    set((s) => {
      const chips = s.chips.filter((c) => c.id !== id);
      const selectedTargets = new Set(s.selectedTargets);
      selectedTargets.delete(chipKey(id));
      return { chips, selectedTargets };
    }),

  renameChip: (id, label) =>
    set((s) => ({
      chips: s.chips.map((c) => (c.id === id ? { ...c, label } : c)),
    })),

  toggleTarget: (key) =>
    set((s) => {
      const selectedTargets = new Set(s.selectedTargets);
      if (selectedTargets.has(key)) selectedTargets.delete(key);
      else selectedTargets.add(key);
      return { selectedTargets };
    }),

  selectTarget: (key) =>
    set((s) => {
      if (s.selectedTargets.has(key)) return {};
      const selectedTargets = new Set(s.selectedTargets);
      selectedTargets.add(key);
      return { selectedTargets };
    }),

  clearTargets: () => set({ selectedTargets: new Set<TargetKey>() }),

  uniqueLabel: (base) => {
    const trimmed = base.trim() || 'Selection';
    const existing = new Set(get().chips.map((c) => c.label));
    if (!existing.has(trimmed)) return trimmed;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${trimmed} (${i})`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${trimmed} ${crypto.randomUUID().slice(0, 4)}`;
  },

  findOverlappingChip: (predicate) => get().chips.find(predicate),

  reset: () =>
    set({ chips: [], selectedTargets: new Set<TargetKey>() }),
}));
