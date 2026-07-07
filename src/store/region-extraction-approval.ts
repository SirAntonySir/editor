import { create } from 'zustand';

/** What to do with an attached region before the agent turn runs.
 *  `draw` opts out of AI segmentation entirely — the node is armed for a manual
 *  magic-lasso draw instead. */
export type ExtractChoice = 'node' | 'layer' | 'deny' | 'draw';

export interface PendingRegion {
  id: string;
  label: string;
}

/**
 * Approval gate for the deterministic pre-extraction of attached `@region`
 * chips. Before `runAgentTurn` segments/extracts a region, it asks here; the
 * dock UI (`RegionExtractionApproval`) renders a chip per pending region with
 * three choices and resolves it. Promises aren't kept in Zustand state — only
 * the render data is; the resolver fns live in a module-level map.
 */
interface RegionExtractionApprovalState {
  pending: PendingRegion[];
  /** Enqueue a region decision; resolves when the user picks (or `reset`). */
  request(label: string): Promise<ExtractChoice>;
  resolve(id: string, choice: ExtractChoice): void;
  /** Resolve any outstanding requests to `deny` and clear (session close / abort). */
  reset(): void;
}

const resolvers = new Map<string, (choice: ExtractChoice) => void>();
let counter = 0;

export const useRegionExtractionApproval = create<RegionExtractionApprovalState>((set) => ({
  pending: [],
  request: (label) =>
    new Promise<ExtractChoice>((resolve) => {
      const id = `rgnapp-${++counter}`;
      resolvers.set(id, resolve);
      set((s) => ({ pending: [...s.pending, { id, label }] }));
    }),
  resolve: (id, choice) => {
    const r = resolvers.get(id);
    if (r) {
      resolvers.delete(id);
      r(choice);
    }
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
  },
  reset: () => {
    for (const [, r] of resolvers) r('deny');
    resolvers.clear();
    set({ pending: [] });
  },
}));
