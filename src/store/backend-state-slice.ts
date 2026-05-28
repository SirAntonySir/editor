import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type {
  SessionStateSnapshot,
  StateEvent,
  Widget,
} from '@/types/widget';
import { maskStore, type Mask } from '@/core/mask-store';
import { maskPngBase64ToBytes } from '@/lib/sam/sam-client';

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
  /** True once the widget_mint phase completes — the terminal MCP analyze phase. */
  mcpAnalyzeComplete: boolean;
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
    mcpAnalyzeComplete: false,

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
            // Remove widget from snapshot — accept is a backend-confirmed terminal state.
            // Adjustment materialization now happens server-side; the backend will emit
            // updated operation_graph nodes that the pipeline picks up automatically.
            if (s.snapshot) {
              s.snapshot.widgets = s.snapshot.widgets.filter((w) => w.id !== id);
            }
            break;
          }
          case 'mask.created': {
            // Backend emits a flat payload with mask metadata + PNG bytes.
            const p = payload as {
              mask_id: string;
              source: string;
              label?: string | null;
              width: number;
              height: number;
              png_b64?: string;
            };
            // Push MaskSummary into snapshot.masks_index so the inspector chip
            // cloud sees it.
            if (s.snapshot) {
              s.snapshot.masks_index.push({
                id: p.mask_id,
                width: p.width,
                height: p.height,
                source: p.source,
                label: p.label ?? null,
              });
            }
            // Decode PNG → Uint8Array → register in maskStore so hover
            // hit-test works. Fire-and-forget; maskStore is independent of
            // zustand immer state.
            if (p.png_b64) {
              void registerMaskFromPng(p.mask_id, p.png_b64, p.width, p.height, p.label ?? undefined, p.source);
            }
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
              s.mcpAnalyzeComplete = true;
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
        s.mcpAnalyzeComplete = false;
      }),
  })),
);

async function registerMaskFromPng(
  maskId: string,
  pngB64: string,
  _width: number,
  _height: number,
  label: string | undefined,
  source: string,
): Promise<void> {
  try {
    const { data, width, height } = await maskPngBase64ToBytes(pngB64);
    // maskStore.register auto-generates a UUID id, but we want to use the
    // backend's mask_id so the frontend lookup matches the SSE event id.
    // Inject directly via injectWithId().
    const mask: Mask = {
      id: maskId,
      layerId: 'ai-proposed', // synthetic; precomputed masks aren't tied to a user layer
      label,
      width,
      height,
      data,
      source: (source === 'sam_box' ? 'ai-proposed' : (source as Mask['source'])),
      createdAt: Date.now(),
    };
    maskStore.injectWithId(mask);
  } catch (err) {
    console.warn('[mask.created] decode failed for', maskId, err);
  }
}
