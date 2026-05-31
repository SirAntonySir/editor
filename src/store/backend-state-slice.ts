import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type {
  ControlValue,
  SessionStateSnapshot,
  StateEvent,
  Widget,
} from '@/types/widget';
import { maskStore, type Mask } from '@/core/mask-store';
import { maskPngBase64ToBytes } from '@/lib/sam/sam-client';
import { deletePrefix } from '@/core/pixel-source-store';
import { tetherWorkspaceWidget } from '@/lib/workspace-tether';

// Required so immer can produce drafts of Map<WidgetId, OptimisticPatch>.
enableMapSet();

const SESSION_STORAGE_KEY = 'editor.backend.sessionId';

/** Read the persisted session id from localStorage, or null if absent / unavailable. */
export function getPersistedSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

type WidgetId = string;

export interface OptimisticPatch {
  // value mirrors ControlValue: scalars, or a CurvesValue for live curve-editor preview.
  bindings: { paramKey: string; value: ControlValue }[];
  baseRevision: number;
}

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type PhaseName =
  | 'update'
  | 'mechanical'
  | 'sam_embed'
  | 'ai_context'
  | 'mask_precompute'
  | 'widget_mint';

export type PhaseStatus = 'pending' | 'active' | 'done';

export interface PhaseInfo {
  status: PhaseStatus;
  /** Sub-progress counters — currently only mask_precompute reports these. */
  done?: number;
  total?: number;
}

export type PhaseMap = Record<PhaseName, PhaseInfo>;

/** Canonical analyze phase order — mirrors the backend's emission sequence. */
export const PHASE_ORDER: PhaseName[] = [
  'update',
  'mechanical',
  'sam_embed',
  'ai_context',
  'mask_precompute',
  'widget_mint',
];

function makePendingPhases(): PhaseMap {
  return {
    update: { status: 'pending' },
    mechanical: { status: 'pending' },
    sam_embed: { status: 'pending' },
    ai_context: { status: 'pending' },
    mask_precompute: { status: 'pending' },
    widget_mint: { status: 'pending' },
  };
}

/**
 * The phase to surface in single-line UIs: the furthest-along phase that is
 * currently active (phases 2–4 run concurrently in the backend, so several may
 * be active at once). Returns null when no phase is active.
 */
export function representativePhase(phases: PhaseMap | null): PhaseName | null {
  if (!phases) return null;
  let found: PhaseName | null = null;
  for (const name of PHASE_ORDER) {
    if (phases[name].status === 'active') found = name;
  }
  return found;
}

interface BackendState {
  sessionId: string | null;
  snapshot: SessionStateSnapshot | null;
  optimistic: Map<WidgetId, OptimisticPatch>;
  acceptedSuggestions: Set<string>;
  sseStatus: SseStatus;
  /** Per-phase status of the in-flight (or just-completed) analyze run; null before any analyze. */
  phases: PhaseMap | null;
  /** True once the widget_mint phase completes — the terminal MCP analyze phase. */
  mcpAnalyzeComplete: boolean;
  applyEvent: (ev: StateEvent) => void;
  applyOptimistic: (widgetId: WidgetId, patch: OptimisticPatch) => void;
  clearOptimistic: (widgetId: WidgetId) => void;
  /** Frontend-only engage: moves a suggestion widget into the acceptedSuggestions set
   *  so it appears on the canvas shell. Does NOT call backendTools.accept_widget. */
  addAcceptedSuggestion: (widgetId: WidgetId) => void;
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
    phases: null,
    mcpAnalyzeComplete: false,

    applyEvent: (ev) =>
      set((s) => {
        const payload = ev.payload as Record<string, unknown>;

        // ── Analyze phase lifecycle ──────────────────────────────────────
        // Handled before the snapshot guard: during the initial analyze the
        // snapshot is still null (it's fetched only after analyze returns), so
        // gating these on a snapshot would silently drop every phase event.
        // They drive the progress stepper, not snapshot contents.
        switch (ev.kind) {
          case 'phase.started': {
            const { phase, index } = payload as { phase: PhaseName; index: number };
            // index === 1 (the "update" phase) marks the start of a fresh run —
            // reset the map and completion flag so a re-analyze doesn't inherit
            // stale "done" state.
            if (index === 1 || !s.phases) {
              s.phases = makePendingPhases();
              s.mcpAnalyzeComplete = false;
            }
            if (s.phases[phase]) s.phases[phase].status = 'active';
            return;
          }
          case 'phase.progress': {
            const { phase, done, total } = payload as { phase: PhaseName; done: number; total: number };
            if (s.phases?.[phase]) {
              s.phases[phase].done = done;
              s.phases[phase].total = total;
            }
            return;
          }
          case 'phase.completed': {
            const { phase } = payload as { phase: PhaseName };
            if (!s.phases) s.phases = makePendingPhases();
            if (s.phases[phase]) s.phases[phase].status = 'done';
            if (phase === 'widget_mint') s.mcpAnalyzeComplete = true;
            return;
          }
        }

        if (!s.snapshot) return;
        // Defensive: drop stale events.
        if (ev.revision <= s.snapshot.revision) return;

        switch (ev.kind) {
          case 'widget.created': {
            const w = payload.widget as Widget;
            s.snapshot.widgets.push(w);
            tetherWorkspaceWidget(w);
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
        }

        // Widget lifecycle events embed the freshly-projected operation_graph
        // (the renderer only knows op_graph nodes). Swap it in so newly
        // created/edited widgets reach the canvas without a full re-fetch.
        const incomingGraph = (payload as { operation_graph?: SessionStateSnapshot['operation_graph'] }).operation_graph;
        if (incomingGraph) s.snapshot.operation_graph = incomingGraph;

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

    addAcceptedSuggestion: (widgetId) =>
      set((s) => {
        s.acceptedSuggestions.add(widgetId);
      }),

    setSseStatus: (status) => set((s) => { s.sseStatus = status; }),
    setSnapshot: (snapshot) => set((s) => { s.snapshot = snapshot; }),
    setSessionId: (sessionId) =>
      set((s) => {
        s.sessionId = sessionId;
        try {
          if (sessionId) {
            localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
          } else {
            localStorage.removeItem(SESSION_STORAGE_KEY);
          }
        } catch {
          // localStorage may be disabled (private mode); ignore.
        }
      }),

    reset: () =>
      set((s) => {
        // Fire-and-forget IDB wipe of the outgoing session's blobs before
        // we clear the id from in-memory state.
        if (s.sessionId) void deletePrefix(s.sessionId);
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.acceptedSuggestions = new Set();
        s.sseStatus = 'idle';
        s.phases = null;
        s.mcpAnalyzeComplete = false;
        try {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch { /* localStorage may be disabled (private mode); ignore. */ }
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
