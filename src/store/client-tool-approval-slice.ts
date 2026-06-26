import { create } from 'zustand';

/** A mutate-kind client tool the backend asked us to run, awaiting the user's
 *  allow/deny decision. `query` tools never enter this queue — they auto-run. */
export interface PendingClientTool {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
}

interface ClientToolApprovalState {
  pending: PendingClientTool[];
  enqueue: (req: PendingClientTool) => void;
  remove: (requestId: string) => void;
  reset: () => void;
}

export const useClientToolApproval = create<ClientToolApprovalState>((set) => ({
  pending: [],
  enqueue: (req) =>
    set((s) =>
      s.pending.some((p) => p.requestId === req.requestId)
        ? s
        : { pending: [...s.pending, req] },
    ),
  remove: (requestId) =>
    set((s) => ({ pending: s.pending.filter((p) => p.requestId !== requestId) })),
  reset: () => set({ pending: [] }),
}));
