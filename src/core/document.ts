/**
 * EditorDocument — the unified state machine / facade.
 *
 * Coordinates: Zustand store, PixelStore, HistoryManager, and Serializer.
 */
import type { StoreApi } from 'zustand';
import type {
  DocumentMeta,
  SerializableState,
  InteractionSession,
} from './types';
import type { EditorState } from '@/store';
import { pixelStore } from './pixel-store';
import * as history from './history';
import { useAiSession } from '@/hooks/useImageContext';
import * as session from './session-storage';
import type { FitMode } from '@/store/viewport-slice';
import type { EditorMode } from '@/store/tool-slice';

const DEBOUNCE_MS = 2000;
const SESSION_SAVE_DEBOUNCE_MS = 3000;

// ─── Narrow serialised string values (from JSON manifests) to enum types
const FIT_MODES = ['fit', 'fill', 'actual'] as const satisfies readonly FitMode[];
const EDITOR_MODES = ['develop', 'compose'] as const satisfies readonly EditorMode[];

function asFitMode(value: string): FitMode {
  return (FIT_MODES as readonly string[]).includes(value) ? (value as FitMode) : 'fit';
}

function asEditorMode(value: string): EditorMode {
  return (EDITOR_MODES as readonly string[]).includes(value) ? (value as EditorMode) : 'develop';
}

let store: StoreApi<EditorState> | null = null;
let interaction: InteractionSession | null = null;
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let aiSessionUnsubscribe: (() => void) | null = null;

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
    !deepEqual(a.layers, b.layers);
}

// ─── State capture / restore ────────────────────────────────────────

function captureState(): SerializableState | null {
  if (!store) return null;
  const s = store.getState();
  return {
    layers: structuredClone(s.layers),
    activeLayerId: s.activeLayerId,
    pixelVersion: s.pixelVersion,
  };
}

function restoreState(snapshot: SerializableState): void {
  if (!store) return;
  store.setState({
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    pixelVersion: snapshot.pixelVersion,
  });
}

function markDirty(): void {
  if (store) store.setState({ isDirty: true });
  scheduleSessionSave();
}

function markClean(): void {
  if (store) store.setState({ isDirty: false });
}

// ─── Session auto-save ──────────────────────────────────────────────

function scheduleSessionSave(): void {
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    persistSession();
  }, SESSION_SAVE_DEBOUNCE_MS);
}

function persistSession(): void {
  if (!store) return;
  const s = store.getState();
  if (!s.documentMeta) return;

  session.saveSession({
    meta: s.documentMeta,
    layers: s.layers,
    activeLayerId: s.activeLayerId,
    viewport: {
      zoom: s.zoom ?? 1,
      panX: s.panX ?? 0,
      panY: s.panY ?? 0,
      fitMode: s.fitMode ?? 'fit',
    },
    editorMode: s.editorMode ?? 'develop',
    imageContext: useAiSession.getState().context ?? undefined,
    pixelStore,
  }).catch(() => {
    // Session save is best-effort — silently ignore errors
  });
}

// ─── Initialization ─────────────────────────────────────────────────

function init(zustandStore: StoreApi<EditorState>): void {
  store = zustandStore;

  // beforeunload guard
  beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (store?.getState().isDirty) {
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  // Persist sessions when the AI session's context changes (e.g. after
  // analyse completes or "Re-analyze image"). Without this, contexts produced
  // outside an editor mutation would never be persisted.
  let lastContext = useAiSession.getState().context;
  aiSessionUnsubscribe = useAiSession.subscribe((state) => {
    if (state.context !== lastContext) {
      lastContext = state.context;
      scheduleSessionSave();
    }
  });
}

function dispose(): void {
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
  if (aiSessionUnsubscribe) {
    aiSessionUnsubscribe();
    aiSessionUnsubscribe = null;
  }
  // Flush pending session save synchronously before teardown
  persistSession();
  store = null;
}

// ─── Document lifecycle ─────────────────────────────────────────────

function newDocument(): void {
  pixelStore.clear();
  history.clear();
  session.clearSession().catch(() => {});
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

async function openImage(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0);

  // Reset state
  pixelStore.clear();
  history.clear();

  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);

  const meta: DocumentMeta = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    width: bitmap.width,
    height: bitmap.height,
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
          adjustmentStack: { adjustments: [] },
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

  bitmap.close();
  scheduleSessionSave();
}

async function openEdp(_file: File): Promise<void> {
  // TODO(Task 6): implement .edp loading with new linear history
  // Left as no-op pending serializer migration.
}

async function save(): Promise<Blob | null> {
  // TODO(Task 6): implement .edp saving with new linear history
  // Left as no-op pending serializer migration.
  markClean();
  return null;
}

async function saveAs(_name?: string): Promise<void> {
  // TODO(Task 6): implement .edp save-as with new linear history
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
 */
function recordSnapshot(_label: string, fn: () => void): void {
  if (!store) {
    fn(); // not initialized — action runs but no history entry
    return;
  }
  fn();
  const snap = captureState();
  if (snap) {
    history.push(snap);
    markDirty();
  }
}

// ─── Undo / redo ────────────────────────────────────────────────────

function undoAction(): void {
  if (interaction) endInteraction();
  const snap = history.undo<SerializableState>();
  if (snap) restoreState(snap);
}

function redoAction(): void {
  if (interaction) endInteraction();
  const snap = history.redo<SerializableState>();
  if (snap) restoreState(snap);
}

// ─── Session restore ─────────────────────────────────────────────────

async function restoreSession(): Promise<boolean> {
  if (!store) return false;

  const data = await session.loadSession();
  if (!data) return false;

  const { manifest, pixels } = data;

  // Restore pixel data
  pixelStore.clear();
  for (const [layerId, blob] of pixels) {
    // Skip legacy '-original' entries from older sessions
    if (layerId.endsWith('-original')) continue;
    await pixelStore.importLayerFromPng(layerId, blob, 'source');
  }

  // Deserialize layers (Float32Array conversion)
  const layers = session.deserializeSessionLayers(manifest);

  history.clear();

  // Restore Zustand state (single source of truth)
  // Bump pixelVersion to signal that new pixel data is available,
  // so preview hooks re-render after session restore.
  store.setState({
    layers,
    activeLayerId: manifest.activeLayerId,
    pixelVersion: (store.getState().pixelVersion ?? 0) + 1,
    zoom: manifest.viewport.zoom,
    panX: manifest.viewport.panX,
    panY: manifest.viewport.panY,
    fitMode: asFitMode(manifest.viewport.fitMode),
    editorMode: asEditorMode(manifest.editorMode ?? 'develop'),
    documentMeta: manifest.meta,
    isDirty: false,
  });

  // Seed history with the loaded state so the first undo behaves correctly.
  const seed = captureState();
  if (seed) history.initWith(seed);

  // Restore cached image context — no Claude call. SessionId stays null;
  // "Re-analyze image" menu item kicks off a fresh upload when the user wants
  // Cmd+K to work again.
  if (manifest.imageContext) {
    useAiSession.getState().restoreContext(manifest.imageContext);
  } else {
    useAiSession.getState().reset();
  }
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────

export const editorDocument = {
  // Lifecycle
  init,
  dispose,
  newDocument,
  openImage,
  openEdp,
  save,
  saveAs,
  restoreSession,

  // Interactions (slider debouncing)
  beginInteraction,
  tickInteraction,
  endInteraction,
  get hasActiveInteraction() {
    return interaction !== null;
  },

  // Discrete actions
  recordSnapshot,

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
