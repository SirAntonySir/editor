import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type {
  SessionStateSnapshot,
  StateEvent,
  Widget,
  MaskSummary,
} from '@/types/widget';

// Required so immer can produce drafts of Map<WidgetId, OptimisticPatch>.
enableMapSet();

type WidgetId = string;

export interface OptimisticPatch {
  bindings: { paramKey: string; value: number | string | boolean }[];
  baseRevision: number;
}

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type PhaseName = 'mechanical' | 'sam_embed' | 'ai_context' | 'mask_precompute' | 'widget_mint';

export interface PhaseState {
  phase: PhaseName;
  index: number;
  total: number;
  done: number;
  phaseTotal?: number;
}

interface BackendState {
  sessionId: string | null;
  snapshot: SessionStateSnapshot | null;
  optimistic: Map<WidgetId, OptimisticPatch>;
  acceptedSuggestions: Set<string>;
  sseStatus: SseStatus;
  currentPhase: PhaseState | null;
  applyEvent: (ev: StateEvent) => void;
  applyOptimistic: (widgetId: WidgetId, patch: OptimisticPatch) => void;
  clearOptimistic: (widgetId: WidgetId) => void;
  setSseStatus: (status: SseStatus) => void;
  setSnapshot: (snapshot: SessionStateSnapshot) => void;
  setSessionId: (sessionId: string | null) => void;
  reset: () => void;
}

export const useBackendState = create<BackendState>()(
  immer((set) => ({
    sessionId: null,
    snapshot: null,
    optimistic: new Map(),
    acceptedSuggestions: new Set(),
    sseStatus: 'idle',
    currentPhase: null,

    applyEvent: (ev) =>
      set((s) => {
        if (!s.snapshot) return;
        // Defensive: drop stale events.
        if (ev.revision <= s.snapshot.revision) return;

        const payload = ev.payload as Record<string, unknown>;

        switch (ev.kind) {
          case 'widget.created': {
            const w = payload.widget as Widget;
            s.snapshot.widgets.push(w);
            break;
          }
          case 'widget.updated': {
            const w = payload.widget as Widget;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === w.id);
            if (idx >= 0) s.snapshot.widgets[idx] = w;
            break;
          }
          case 'widget.deleted': {
            const id = payload.widget_id as string;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === id);
            if (idx >= 0) s.snapshot.widgets[idx].status = 'dismissed';
            break;
          }
          case 'widget.restored': {
            const id = payload.widget_id as string;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === id);
            if (idx >= 0) s.snapshot.widgets[idx].status = 'active';
            break;
          }
          case 'widget.accepted': {
            const id = payload.widget_id as string;
            s.acceptedSuggestions.add(id);
            break;
          }
          case 'mask.created': {
            const summary = payload.mask as MaskSummary;
            if (summary) s.snapshot.masks_index.push(summary);
            break;
          }
          case 'context.updated': {
            s.snapshot.image_context = payload.image_context ?? null;
            break;
          }
          case 'selection.changed':
          case 'dismissal.added':
            // No snapshot change; subscribers (e.g. maskStore) handle these.
            break;
          case 'phase.started': {
            const { phase, index, total } = payload as { phase: PhaseName; index: number; total: number };
            s.currentPhase = { phase, index, total, done: 0 };
            break;
          }
          case 'phase.progress': {
            if (!s.currentPhase) break;
            const { done, total } = payload as { done: number; total: number };
            s.currentPhase.done = done;
            s.currentPhase.phaseTotal = total;
            break;
          }
          case 'phase.completed': {
            const { phase } = payload as { phase: PhaseName };
            if (phase === 'widget_mint') {
              s.currentPhase = null;
            }
            break;
          }
        }

        s.snapshot.revision = ev.revision;

        // Drop optimistic patches whose baseRevision is now stale.
        for (const [wid, patch] of s.optimistic) {
          if (patch.baseRevision < ev.revision) s.optimistic.delete(wid);
        }
      }),

    applyOptimistic: (widgetId, patch) =>
      set((s) => {
        s.optimistic.set(widgetId, patch);
      }),

    clearOptimistic: (widgetId) =>
      set((s) => {
        s.optimistic.delete(widgetId);
      }),

    setSseStatus: (status) => set((s) => { s.sseStatus = status; }),
    setSnapshot: (snapshot) => set((s) => { s.snapshot = snapshot; }),
    setSessionId: (sessionId) => set((s) => { s.sessionId = sessionId; }),

    reset: () =>
      set((s) => {
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.acceptedSuggestions = new Set();
        s.sseStatus = 'idle';
        s.currentPhase = null;
      }),
  })),
);
