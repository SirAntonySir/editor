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
import { useEditorStore } from '@/store';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { GLOBAL_SCOPE } from '@/types/scope';

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
  sseStatus: SseStatus;
  /** Per-phase status of the in-flight (or just-completed) analyze run; null before any analyze. */
  phases: PhaseMap | null;
  /** True once the widget_mint phase completes — the terminal MCP analyze phase. */
  mcpAnalyzeComplete: boolean;
  /** True when the most recent analyze run was user-cancelled (phase.cancelled
   *  event). Resets when the next analyze starts. The status bar uses this to
   *  fade out without showing a "complete" state. */
  mcpAnalyzeCancelled: boolean;
  /** True after the user clicks the cancel button and we've called the cancel
   *  endpoint, but before phase.cancelled arrives. Drives a brief "Cancelling…"
   *  label on the status bar. */
  cancelling: boolean;
  /** Cumulative token usage across the current analyze run. Null before any
   *  analyze. Accumulates from mcp.usage events; resets when phase.started
   *  fires for index === 1. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
  } | null;
  applyEvent: (ev: StateEvent) => void;
  applyOptimistic: (widgetId: WidgetId, patch: OptimisticPatch) => void;
  clearOptimistic: (widgetId: WidgetId) => void;
  setSseStatus: (status: SseStatus) => void;
  setSnapshot: (snapshot: SessionStateSnapshot) => void;
  setSessionId: (sessionId: string | null) => void;
  /** Optimistically drop a mask from snapshot.masksIndex + maskStore +
   *  objectOwnership ahead of the backend's `mask.deleted` SSE echo (the
   *  handler is idempotent). Also resets activeScope when it pointed at
   *  the removed mask. */
  pushMaskDeleted: (maskId: string) => void;
  /** Optimistically patch a mask's label in snapshot.masksIndex + maskStore
   *  ahead of the `mask.renamed` SSE echo. */
  pushMaskRename: (maskId: string, label: string) => void;
  /** Mark a cancel-in-flight before the SSE event lands. */
  setCancelling: (cancelling: boolean) => void;
  reset: () => void;
}

export const useBackendState = create<BackendState>()(
  immer((set) => ({
    sessionId: null,
    snapshot: null,
    optimistic: new Map(),
    sseStatus: 'idle',
    phases: null,
    mcpAnalyzeComplete: false,
    mcpAnalyzeCancelled: false,
    cancelling: false,
    usage: null,

    applyEvent: (ev) => {
      // Side-effects queue: cross-store mutations and async refetches that
      // happen during SSE handling are pushed here from inside the Immer
      // producer, then drained AFTER `set(...)` returns. Keeps the reducer
      // pure and lets side effects observe a settled store.
      const sideEffects: Array<() => void> = [];

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
              s.mcpAnalyzeCancelled = false;
              s.cancelling = false;
              s.usage = null;
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
          case 'phase.cancelled': {
            // User-initiated cancel landed. Flip the cancelled flag; the
            // status bar reads it to fade out without showing "complete".
            s.mcpAnalyzeCancelled = true;
            s.cancelling = false;
            return;
          }
          case 'mcp.usage': {
            const p = payload as {
              input_tokens?: number;
              output_tokens?: number;
              cache_create?: number;
              cache_read?: number;
            };
            const prev = s.usage ?? { inputTokens: 0, outputTokens: 0, cacheCreate: 0, cacheRead: 0 };
            s.usage = {
              inputTokens: prev.inputTokens + (p.input_tokens ?? 0),
              outputTokens: prev.outputTokens + (p.output_tokens ?? 0),
              cacheCreate: prev.cacheCreate + (p.cache_create ?? 0),
              cacheRead: prev.cacheRead + (p.cache_read ?? 0),
            };
            return;
          }
          case 'state.gap': {
            // Backend signaled that replay can't catch us up — doc.history was
            // pruned past our lastEventId. Refetch the full snapshot to resync.
            const sid = s.sessionId;
            if (sid) {
              // Defer the async refetch to a side-effect; the closure
              // observes a settled store. Re-check that `sid` is still
              // the active session at write time — between event and
              // refetch completion the user may have opened a new image,
              // and writing the stale snapshot would clobber the new
              // session's state.
              sideEffects.push(() => {
                void (async () => {
                  try {
                    const { fetchSnapshot } = await import('@/lib/sse-subscriber');
                    const snap = await fetchSnapshot(sid);
                    if (useBackendState.getState().sessionId !== sid) {
                      console.warn(
                        '[sse] state.gap refetch dropped — session changed during fetch',
                      );
                      return;
                    }
                    useBackendState.getState().setSnapshot(snap);
                  } catch (err) {
                    console.warn('[sse] state.gap refetch failed:', err);
                  }
                })();
              });
            }
            return;
          }
          case 'history.applied': {
            // Backend undo/redo/revert landed. Payload carries the full
            // restored projection so we can swap snapshot state in one
            // shot rather than re-fetching the REST snapshot.
            if (!s.snapshot) return;
            const p = payload as {
              operationGraph?: SessionStateSnapshot['operationGraph'];
              widgets?: SessionStateSnapshot['widgets'];
              masksIndex?: SessionStateSnapshot['masksIndex'];
            };
            if (p.operationGraph) s.snapshot.operationGraph = p.operationGraph;
            if (p.widgets) s.snapshot.widgets = p.widgets;
            if (p.masksIndex) s.snapshot.masksIndex = p.masksIndex;
            s.snapshot.revision = ev.revision;
            // Any in-flight optimistic patches are stale — the restored
            // snapshot is authoritative.
            s.optimistic.clear();
            return;
          }
          case 'context.updated': {
            // Handled BEFORE the snapshot guard because partial deltas can
            // race the initial REST snapshot fetch. If the snapshot isn't
            // there yet, stash a minimal one with just the image_context so
            // subsequent partials have something to merge into. The later
            // snapshot fetch overlays the rest of the state (widgets,
            // op_graph, etc.) on top; image_context survives intact.
            const partial = payload.imageContext as
              | Partial<NonNullable<SessionStateSnapshot['imageContext']>>
              | undefined;
            if (!partial) return;
            if (s.snapshot) {
              const existing = s.snapshot.imageContext ?? {};
              s.snapshot.imageContext = { ...existing, ...partial } as never;
              s.snapshot.revision = ev.revision;
            } else {
              s.snapshot = {
                sessionId: '',
                revision: ev.revision,
                widgets: [],
                masksIndex: [],
                operationGraph: { id: '', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
                imageContext: partial as never,
              } as never;
            }
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
            // Bridge into the FE-only suggestions UI slice for autonomous
            // suggestions — deferred to a side-effect so the cross-store
            // call observes a settled `useSuggestionsUi`.
            if (w.origin.kind === 'mcp_autonomous') {
              sideEffects.push(() => {
                const existing = useSuggestionsUi.getState().pendingSuggestionIds;
                useSuggestionsUi.getState().markPending([...existing, w.id]);
              });
            }
            // Drain a matching per-slider Pin request (queued before the
            // backend roundtrip). Deferred for the same reason.
            if (w.origin.kind === 'tool_invoked') {
              const firstNode = w.nodes[0];
              const layerId = firstNode?.layerId;
              const opType = firstNode?.type;
              if (layerId && opType) {
                sideEffects.push(() => {
                  const keys = useEditorStore.getState().consumePinRequest(layerId, opType);
                  if (keys && keys.length > 0) {
                    useEditorStore.getState().setPinnedWidgetParams(w.id, keys);
                  }
                });
              }
            }
            // Workspace tether placement also touches useEditorStore;
            // defer to keep the producer pure.
            sideEffects.push(() => tetherWorkspaceWidget(w));
            break;
          }
          case 'widget.updated': {
            const w = payload.widget as Widget;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === w.id);
            if (idx >= 0) s.snapshot.widgets[idx] = w;
            break;
          }
          case 'widget.deleted': {
            const id = payload.widgetId as string;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === id);
            if (idx >= 0) s.snapshot.widgets[idx].status = 'dismissed';
            break;
          }
          case 'widget.restored': {
            const id = payload.widgetId as string;
            const idx = s.snapshot.widgets.findIndex((x) => x.id === id);
            if (idx >= 0) s.snapshot.widgets[idx].status = 'active';
            break;
          }
          case 'widget.accepted': {
            const id = payload.widgetId as string;
            // Remove widget from snapshot — accept is a backend-confirmed terminal state.
            // Adjustment materialization now happens server-side; the backend will emit
            // updated operation_graph nodes that the pipeline picks up automatically.
            // NOTE: we deliberately do NOT touch useSuggestionsUi.acceptedSuggestions
            // here — by the time backend confirms acceptance, the FE has already
            // added the widget via either SuggestionChips.handleAllow (user click)
            // or useAutoTetherAiSuggestions (auto-tether on session resume).
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
              image_node_id?: string | null;
            };
            // Push MaskSummary into snapshot.masks_index so the inspector chip
            // cloud sees it.
            if (s.snapshot) {
              s.snapshot.masksIndex.push({
                id: p.mask_id,
                width: p.width,
                height: p.height,
                source: p.source,
                label: p.label ?? null,
                imageNodeId: p.image_node_id ?? null,
              });
            }
            // Decode PNG → Uint8Array → register in maskStore so hover
            // hit-test works. Fire-and-forget; maskStore is independent of
            // zustand immer state.
            if (p.png_b64) {
              void registerMaskFromPng(
                p.mask_id,
                p.png_b64,
                p.width,
                p.height,
                p.label ?? undefined,
                p.source,
                p.image_node_id ?? null,
              );
            }
            break;
          }
          case 'mask.deleted': {
            const { mask_id } = payload as { mask_id: string };
            if (s.snapshot) {
              s.snapshot.masksIndex = s.snapshot.masksIndex.filter((m) => m.id !== mask_id);
            }
            sideEffects.push(() => {
              maskStore.remove(mask_id);
              objectOwnership.clear(mask_id);
              const editor = useEditorStore.getState();
              if (editor.activeScope.kind === 'mask' && editor.activeScope.mask_id === mask_id) {
                editor.setActiveScope(GLOBAL_SCOPE);
              }
            });
            break;
          }
          case 'mask.renamed': {
            const { mask_id, label } = payload as { mask_id: string; label: string };
            if (s.snapshot) {
              const entry = s.snapshot.masksIndex.find((m) => m.id === mask_id);
              if (entry) entry.label = label;
            }
            sideEffects.push(() => maskStore.setLabel(mask_id, label));
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
        const incomingGraph = (payload as { operationGraph?: SessionStateSnapshot['operationGraph'] }).operationGraph;
        if (incomingGraph) s.snapshot.operationGraph = incomingGraph;

        s.snapshot.revision = ev.revision;

        // Drop optimistic patches whose baseRevision is now stale.
        for (const [wid, patch] of s.optimistic) {
          if (patch.baseRevision < ev.revision) s.optimistic.delete(wid);
        }
      });

      for (const effect of sideEffects) effect();
    },

    applyOptimistic: (widgetId, patch) =>
      set((s) => {
        const existing = s.optimistic.get(widgetId);
        if (!existing || existing.baseRevision !== patch.baseRevision) {
          s.optimistic.set(widgetId, patch);
          return;
        }
        const byKey = new Map(existing.bindings.map((b) => [b.paramKey, b]));
        for (const b of patch.bindings) byKey.set(b.paramKey, b);
        s.optimistic.set(widgetId, { baseRevision: patch.baseRevision, bindings: [...byKey.values()] });
      }),

    clearOptimistic: (widgetId) =>
      set((s) => {
        s.optimistic.delete(widgetId);
      }),

    setSseStatus: (status) => set((s) => { s.sseStatus = status; }),
    setSnapshot: (snapshot) => set((s) => { s.snapshot = snapshot; }),
    pushMaskDeleted: (maskId) => {
      set((s) => {
        if (s.snapshot) {
          s.snapshot.masksIndex = s.snapshot.masksIndex.filter((m) => m.id !== maskId);
        }
      });
      maskStore.remove(maskId);
      objectOwnership.clear(maskId);
      const editor = useEditorStore.getState();
      if (editor.activeScope.kind === 'mask' && editor.activeScope.mask_id === maskId) {
        editor.setActiveScope(GLOBAL_SCOPE);
      }
    },
    pushMaskRename: (maskId, label) => {
      set((s) => {
        const entry = s.snapshot?.masksIndex.find((m) => m.id === maskId);
        if (entry) entry.label = label;
      });
      maskStore.setLabel(maskId, label);
    },
    setCancelling: (cancelling) => set((s) => { s.cancelling = cancelling; }),
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

    reset: () => {
      set((s) => {
        // Fire-and-forget IDB wipe of the outgoing session's blobs before
        // we clear the id from in-memory state.
        if (s.sessionId) void deletePrefix(s.sessionId);
        s.sessionId = null;
        s.snapshot = null;
        s.optimistic = new Map();
        s.sseStatus = 'idle';
        s.phases = null;
        s.mcpAnalyzeComplete = false;
        s.mcpAnalyzeCancelled = false;
        s.cancelling = false;
        s.usage = null;
        try {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch { /* localStorage may be disabled (private mode); ignore. */ }
      });
      useSuggestionsUi.getState().reset();
    },
  })),
);

async function registerMaskFromPng(
  maskId: string,
  pngB64: string,
  _width: number,
  _height: number,
  label: string | undefined,
  source: string,
  imageNodeId: string | null,
): Promise<void> {
  try {
    const { data, width, height } = await maskPngBase64ToBytes(pngB64);
    // Resolve the owning image node's first image layer so the renderer's
    // per-layer gating (layerSet.has(mask.layerId)) accepts this mask. Falls
    // back to the synthetic 'ai-proposed' marker for untargeted / global
    // precomputed masks that aren't tied to a specific user layer.
    let layerId = 'ai-proposed';
    if (imageNodeId) {
      const editor = useEditorStore.getState();
      const node = editor.imageNodes[imageNodeId];
      const ownLayer = node?.layerIds.find(
        (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
      );
      if (ownLayer) layerId = ownLayer;
    }
    // maskStore.register auto-generates a UUID id, but we want to use the
    // backend's mask_id so the frontend lookup matches the SSE event id.
    // Inject directly via injectWithId().
    const mask: Mask = {
      id: maskId,
      layerId,
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
