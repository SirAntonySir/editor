/**
 * EditorDocument — the unified state machine / facade.
 *
 * Coordinates: Zustand store, PixelStore, and HistoryManager.
 */
import type { StoreApi } from 'zustand';
import type {
  DocumentMeta,
  SerializableState,
  InteractionSession,
} from './types';
import type { EditorState } from '@/store';
import type { InfoNodeContent, InfoNodeState, Point, Size, TetherEdgeState } from '@/types/workspace';
import { pixelStore } from './pixel-store';
import * as history from './history';
import { putSource } from './pixel-source-store';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { clearInternalCanvasCache } from '@/lib/image-node-geometry';
import { parseImageMetadata } from '@/lib/image-metadata';
import { backendTools } from '@/lib/backend-tools';

const BACKEND_BASE_URL = import.meta.env.VITE_AI_BACKEND_URL ?? 'http://127.0.0.1:8787';

const DEBOUNCE_MS = 2000;

let store: StoreApi<EditorState> | null = null;
let interaction: InteractionSession | null = null;

// ─── Deep equality (handles Float32Array) ───────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (a instanceof Float32Array && b instanceof Float32Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    if (aKeys.length !== Object.keys(bObj).length) return false;
    for (const key of aKeys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}

function statesChanged(a: SerializableState, b: SerializableState): boolean {
  return a.activeLayerId !== b.activeLayerId ||
    a.pixelVersion !== b.pixelVersion ||
    a.activeImageNodeId !== b.activeImageNodeId ||
    !deepEqual(a.layers, b.layers) ||
    !deepEqual(a.imageNodes, b.imageNodes) ||
    !deepEqual(a.widgetNodes, b.widgetNodes) ||
    !deepEqual(a.tetherEdges, b.tetherEdges) ||
    !deepEqual(a.infoNodes, b.infoNodes);
}

// ─── State capture / restore ────────────────────────────────────────

function captureState(): SerializableState | null {
  if (!store) return null;
  const s = store.getState();
  return {
    layers: structuredClone(s.layers),
    activeLayerId: s.activeLayerId,
    pixelVersion: s.pixelVersion,
    imageNodes: structuredClone(s.imageNodes),
    widgetNodes: structuredClone(s.widgetNodes),
    tetherEdges: structuredClone(s.tetherEdges),
    infoNodes: structuredClone(s.infoNodes),
    activeImageNodeId: s.activeImageNodeId,
  };
}

function restoreState(snapshot: SerializableState): void {
  if (!store) return;
  store.setState({
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    pixelVersion: snapshot.pixelVersion,
    imageNodes: snapshot.imageNodes,
    widgetNodes: snapshot.widgetNodes,
    tetherEdges: snapshot.tetherEdges,
    // Tolerate older snapshots that pre-date the infoNodes field.
    infoNodes: snapshot.infoNodes ?? {},
    activeImageNodeId: snapshot.activeImageNodeId,
  });
}

function markDirty(): void {
  if (store) store.setState({ isDirty: true });
}


// ─── Initialization ─────────────────────────────────────────────────

function init(zustandStore: StoreApi<EditorState>): void {
  store = zustandStore;
}

function dispose(): void {
  store = null;
}

// ─── Document lifecycle ─────────────────────────────────────────────

function newDocument(): void {
  pixelStore.clear();
  history.clear();
  const meta: DocumentMeta = {
    id: crypto.randomUUID(),
    name: 'Untitled',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    width: 0,
    height: 0,
  };

  if (store) {
    store.setState({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      documentMeta: meta,
      isDirty: false,
      editorMode: 'develop',
    });
  }
  const seed = captureState();
  if (seed) history.initWith(seed);
}

/**
 * Reset back to the no-document state: clears layers, workspace nodes/edges,
 * pixel data, history, and the persisted backend session (incl. its
 * localStorage entry). Used by the image-node Delete action so the user can
 * upload a fresh image and re-run analyze from scratch — info tab and AI
 * suggestions all clear with the snapshot.
 */
function closeDocument(): void {
  pixelStore.clear();
  history.clear();
  // Drops session id from in-memory state + localStorage and clears snapshot,
  // so the info tab's image_context, regions, and AI suggestions all reset.
  useBackendState.getState().reset();
  // Workspace: image nodes, widget nodes, tether edges, active selection.
  useEditorStore.getState().resetWorkspace();
  clearInternalCanvasCache();
  if (store) {
    store.setState({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      documentMeta: null,
      isDirty: false,
    });
  }
}

async function openImage(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0);

  // EXIF / GPS parse — best-effort, swallows errors. Runs in parallel with
  // the canvas decode above (which has already completed by the time we
  // await here). Net cost: ~few ms for a typical 5–25 MB JPEG.
  const metadata = (await parseImageMetadata(file)) ?? undefined;

  // Reset state
  pixelStore.clear();
  history.clear();

  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);

  // Best-effort: persist the source blob so Cmd+R can rehydrate this layer.
  const sid = useBackendState.getState().sessionId;
  if (sid) void putSource(sid, layerId, file);

  const meta: DocumentMeta = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    width: bitmap.width,
    height: bitmap.height,
    // Native File fields — kept so the Info tab can show format + size
    // without re-reading the blob. Empty `file.type` falls back to undefined
    // (some sources like clipboard paste leave it blank).
    mimeType: file.type || undefined,
    fileSize: file.size,
    metadata,
  };

  if (store) {
    store.setState({
      layers: [
        {
          id: layerId,
          type: 'image',
          name: file.name,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
        },
      ],
      activeLayerId: layerId,
      pixelVersion: 0,
      documentMeta: meta,
      isDirty: false,
      editorMode: 'develop',
    });
  }
  const seed = captureState();
  if (seed) history.initWith(seed);

  // Kick off backend session bootstrap so the toolrail adjustments work
  // immediately — analyse runs later, on explicit user click. Awaiting
  // would block image-open on a backend round-trip, so fire-and-forget.
  // Pass the OffscreenCanvas (not `bitmap` — closed below; not `file` —
  // openSession's downscaleForUpload doesn't accept Blob).
  // Reset useAiSession first: openSession early-returns when sessionId is
  // already set, so without a reset a new image would either skip the
  // upload entirely (re-opening) or inherit a stuck 'uploading'/'error'
  // status from a previous attempt (backend reload, network blip).
  void import('@/hooks/useImageContext').then(({ useAiSession }) => {
    useAiSession.getState().reset();
    void useAiSession.getState().openSession(offscreen);
  });

  bitmap.close();
}

/**
 * Append a second (or Nth) image to the current document/session without
 * resetting any existing state. Creates a new layer + image node placed to
 * the right of the existing ones.
 *
 * Fire-and-forget backend upload: posts the file to
 * `/api/session/{sid}/images`. The backend mints its own image_node_id;
 * the frontend separately mints a workspace id via `addImageNode`. For
 * this slice we accept that the two ids may not match — revival will
 * reconcile.
 */
async function addImage(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0);

  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);

  const sid = useBackendState.getState().sessionId;

  // Best-effort persist source blob so revival can rehydrate this layer.
  if (sid) void putSource(sid, layerId, file);

  // Best-effort backend upload — fire-and-forget. Mismatch in ids is a known
  // gap for this slice; the revival ticket will reconcile.
  if (sid) {
    const fd = new FormData();
    fd.append('image', file);
    void fetch(`${BACKEND_BASE_URL}/api/session/${sid}/images`, {
      method: 'POST',
      body: fd,
    }).catch((err) => {
      console.warn('[addImage] backend upload failed:', err);
    });
  }

  if (store) {
    const existing = Object.values(store.getState().imageNodes);
    const maxRight = existing.reduce(
      (m, n) => Math.max(m, n.position.x + n.size.w),
      0,
    );
    const position = { x: existing.length > 0 ? maxRight + 80 : 0, y: 0 };

    useEditorStore.getState().addImageNode(
      [layerId],
      position,
      { w: bitmap.width, h: bitmap.height },
    );

    store.setState((s) => ({
      layers: [
        ...s.layers,
        {
          id: layerId,
          type: 'image',
          name: file.name,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: s.layers.length,
        },
      ],
      activeLayerId: layerId,
    }));
  }

  const post = captureState();
  if (post) history.push(post);
  markDirty();

  bitmap.close();
}

// ─── Interaction sessions (slider debouncing) ───────────────────────

function beginInteraction(label: string): void {
  const pre = captureState();
  if (!pre) return;
  if (interaction) {
    // Auto-commit dangling interaction
    endInteraction();
  }
  interaction = {
    label,
    preMetaSnapshot: pre,
    debounceTimer: null,
  };
}

function tickInteraction(): void {
  if (!interaction) return;
  // Reset the auto-commit timer
  if (interaction.debounceTimer) {
    clearTimeout(interaction.debounceTimer);
  }
  interaction.debounceTimer = setTimeout(() => {
    endInteraction();
  }, DEBOUNCE_MS);
}

function endInteraction(): void {
  if (!interaction) return;
  if (interaction.debounceTimer) clearTimeout(interaction.debounceTimer);
  const post = captureState();
  if (!post) { interaction = null; return; }
  const pre = interaction.preMetaSnapshot;
  if (statesChanged(pre, post)) {
    history.push(post);
    markDirty();
  }
  interaction = null;
}

// ─── Discrete actions (toggle visibility, reorder, etc.) ────────────

/**
 * Record a discrete mutation and immediately push a snapshot to history.
 *
 * Use this for one-shot actions (e.g. revert, layer reorder, visibility toggle)
 * that should each produce a distinct undo entry without debouncing.
 *
 * Skips the history push when the action produces no observable state change
 * (e.g. a drag-stop with zero displacement), avoiding useless undo entries.
 */
function recordSnapshot<T>(_label: string, fn: () => T): T {
  if (!store) {
    return fn(); // not initialized — action runs but no history entry
  }
  const pre = captureState();
  const result = fn();
  const post = captureState();
  if (pre && post && statesChanged(pre, post)) {
    history.push(post);
    markDirty();
  }
  return result;
}

// ─── Undo / redo ────────────────────────────────────────────────────
//
// Two stacks compose here: the backend's snapshot-based history (canonical
// adjustments, widgets, masks, image-node transforms) and the frontend's
// workspace-layout history (image-node positions, tether edges, widget
// node placement). Undo/redo tries the BACKEND first — slider commits and
// widget lifecycle are far more frequent than workspace ops — then falls
// back to the frontend stack when the backend has nothing.

async function undoAction(): Promise<void> {
  if (interaction) endInteraction();
  const sessionId = useBackendState.getState().sessionId;
  if (sessionId) {
    try {
      const applied = await backendTools.undo(sessionId);
      if (applied !== null) return;  // backend handled it
    } catch (err) {
      console.warn('[history] backend undo failed, falling back:', err);
    }
  }
  const snap = history.undo<SerializableState>();
  if (snap) restoreState(snap);
}

async function redoAction(): Promise<void> {
  if (interaction) endInteraction();
  const sessionId = useBackendState.getState().sessionId;
  if (sessionId) {
    try {
      const applied = await backendTools.redo(sessionId);
      if (applied !== null) return;
    } catch (err) {
      console.warn('[history] backend redo failed, falling back:', err);
    }
  }
  const snap = history.redo<SerializableState>();
  if (snap) restoreState(snap);
}

// ─── Workspace mutations (each pushes a history entry) ──────────────

/**
 * Wrappers that route discrete workspace mutations through `recordSnapshot`
 * so each user-driven graph edit becomes a distinct undo step.
 *
 * NOT wrapped (intentional):
 * - The auto-mount `addImageNode` in `CanvasWorkspace` (initialization).
 * - Per-frame drag updates — only call wrappers on `onNodeDragStop`.
 *
 * SSE-driven placements (`workspace-tether.ts`) ARE wrapped, via `batch`:
 * the user expects undo to be able to roll back a backend-placed widget to
 * the pre-placement state. `batch` consolidates multiple slice mutations
 * (e.g. position + edge) into a single history entry.
 */
const workspace = {
  addImageNode(layerIds: string[], position?: Point): string | undefined {
    return recordSnapshot('Add image node', () =>
      useEditorStore.getState().addImageNode(layerIds, position),
    );
  },

  splitImageNode(sourceId: string, layerIdToSplit: string): string | null {
    return recordSnapshot(
      'Split image node',
      () => useEditorStore.getState().splitImageNode(sourceId, layerIdToSplit) ?? null,
    );
  },

  mergeImageNodes(sourceId: string, targetId: string): void {
    recordSnapshot('Merge image nodes', () =>
      useEditorStore.getState().mergeImageNodes(sourceId, targetId),
    );
  },

  removeImageNode(id: string): void {
    recordSnapshot('Remove image node', () =>
      useEditorStore.getState().removeImageNode(id),
    );
  },

  setEdge(edge: TetherEdgeState): void {
    recordSnapshot('Bind tether', () => useEditorStore.getState().setEdge(edge));
  },

  unbindEdge(edgeId: string): void {
    recordSnapshot('Unbind tether', () => useEditorStore.getState().unbindEdge(edgeId));
  },

  setNodePosition(id: string, position: Point): void {
    recordSnapshot('Move image node', () =>
      useEditorStore.getState().setNodePosition(id, position),
    );
  },

  setWidgetPosition(id: string, position: Point): void {
    recordSnapshot('Move widget', () =>
      useEditorStore.getState().setWidgetPosition(id, position),
    );
  },

  // ─── Info widgets (frontend-only — undo/redo via SerializableState) ──
  addInfoNode(
    content: InfoNodeContent,
    options?: { position?: Point; size?: Size; title?: string; targetImageNodeId?: string },
  ): string | undefined {
    return recordSnapshot('Pin info widget', () =>
      useEditorStore.getState().addInfoNode(content, options),
    );
  },

  setInfoNodePosition(id: string, position: Point): void {
    recordSnapshot('Move info widget', () =>
      useEditorStore.getState().setInfoNodePosition(id, position),
    );
  },

  updateInfoNode(
    id: string,
    patch: Partial<Pick<InfoNodeState, 'content' | 'title' | 'size'>>,
  ): void {
    recordSnapshot('Update info widget', () =>
      useEditorStore.getState().updateInfoNode(id, patch),
    );
  },

  removeInfoNode(id: string): void {
    recordSnapshot('Remove info widget', () =>
      useEditorStore.getState().removeInfoNode(id),
    );
  },

  /**
   * Wrap several slice mutations in a single history snapshot.
   *
   * Use when one logical action involves multiple slice calls (e.g. SSE
   * widget placement = setWidgetPosition + setEdge) and you want them to
   * appear as a single undo step.
   */
  batch(label: string, fn: () => void): void {
    recordSnapshot(label, fn);
  },
};

// ─── Public API ─────────────────────────────────────────────────────

export const editorDocument = {
  // Lifecycle
  init,
  dispose,
  newDocument,
  closeDocument,
  openImage,
  addImage,

  // Interactions (slider debouncing)
  beginInteraction,
  tickInteraction,
  endInteraction,
  get hasActiveInteraction() {
    return interaction !== null;
  },

  // Discrete actions
  recordSnapshot,

  // Workspace mutations (each produces a history entry)
  workspace,

  // Undo / redo
  undo: undoAction,
  redo: redoAction,

  // State (single source of truth: Zustand store)
  get isDirty() {
    return store?.getState().isDirty ?? false;
  },
  get meta() {
    return store?.getState().documentMeta ?? null;
  },
  get pixelStore() {
    return pixelStore;
  },
  get history() {
    return history;
  },
  get historyStore() {
    return history.historyStore;
  },
};
