/**
 * EditorDocument — the unified state machine / facade.
 *
 * Coordinates: Zustand store, PixelStore, HistoryManager,
 * TransactionCoordinator, and Serializer.
 */
import type { StoreApi } from 'zustand';
import type {
  DocumentMeta,
  SerializableState,
  HistoryEntry,
  InteractionSession,
} from './types';
import type { EditorState } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { pixelStore } from './pixel-store';
import * as history from './history';
import * as transaction from './transaction';
import * as serializer from './serializer';
import * as session from './session-storage';
import type { FitMode } from '@/store/viewport-slice';
import type { EditorMode } from '@/store/tool-slice';

const DEBOUNCE_MS = 2000;
const SESSION_SAVE_DEBOUNCE_MS = 3000;

// ─── Narrow serialised string values (from JSON manifests) to enum types
const FIT_MODES = ['fit', 'fill', 'actual'] as const satisfies readonly FitMode[];
const EDITOR_MODES = ['develop', 'compose', 'graph'] as const satisfies readonly EditorMode[];

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

// ─── Discrete action debouncing ──────────────────────────────────
// Groups rapid discrete actions (e.g. slider drags routed through recordAction)
// into a single undo entry when they share the same label within 250ms.
const ACTION_DEBOUNCE_MS = 250;
let pendingAction: {
  label: string;
  preSnapshot: SerializableState;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

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
    graphPositions: structuredClone(useGraphStore.getState().graphPositions),
  };
}

function restoreState(snapshot: SerializableState): void {
  if (!store) return;
  store.setState({
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    pixelVersion: snapshot.pixelVersion,
  });
  useGraphStore.getState().setGraphPositions(snapshot.graphPositions);
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
    graphPositions: useGraphStore.getState().graphPositions,
    viewport: {
      zoom: s.zoom ?? 1,
      panX: s.panX ?? 0,
      panY: s.panY ?? 0,
      fitMode: s.fitMode ?? 'fit',
    },
    editorMode: s.editorMode ?? 'develop',
    pixelStore,
  }).catch(() => {
    // Session save is best-effort — silently ignore errors
  });
}

// ─── Initialization ─────────────────────────────────────────────────

function init(zustandStore: StoreApi<EditorState>): void {
  store = zustandStore;

  // Wire up history restore callback
  history.setRestoreCallback(restoreState);

  // Wire up transaction callbacks
  transaction.setTransactionCallbacks(captureState, restoreState);

  // beforeunload guard
  beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (store?.getState().isDirty) {
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);
}

function dispose(): void {
  flushPendingAction();
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
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
  useGraphStore.getState().setGraphPositions({});
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
  useGraphStore.getState().setGraphPositions({});

  bitmap.close();
  scheduleSessionSave();
}

async function openEdp(file: File): Promise<void> {
  const result = await serializer.load(file);

  history.clear();

  if (store) {
    store.setState({
      layers: result.layers,
      activeLayerId: result.activeLayerId,
      pixelVersion: 0,
      zoom: result.viewport.zoom,
      panX: result.viewport.panX,
      panY: result.viewport.panY,
      fitMode: asFitMode(result.viewport.fitMode),
      documentMeta: result.meta,
      isDirty: false,
      editorMode: 'develop',
    });
  }
  useGraphStore.getState().setGraphPositions(result.graphPositions);

  scheduleSessionSave();
}

async function save(): Promise<Blob | null> {
  if (!store) return null;
  const s = store.getState();
  if (!s.documentMeta) return null;

  const updatedMeta = { ...s.documentMeta, modifiedAt: Date.now() };
  store.setState({ documentMeta: updatedMeta });

  const blob = await serializer.save({
    meta: updatedMeta,
    layers: s.layers,
    activeLayerId: s.activeLayerId,
    graphPositions: useGraphStore.getState().graphPositions,
    viewport: {
      zoom: s.zoom ?? 1,
      panX: s.panX ?? 0,
      panY: s.panY ?? 0,
      fitMode: s.fitMode ?? 'fit',
    },
  });

  markClean();
  return blob;
}

async function saveAs(name?: string): Promise<void> {
  const blob = await save();
  if (!blob) return;

  const fileName = name ?? `${store?.getState().documentMeta?.name ?? 'document'}.edp`;

  // Use native file picker dialog when available (Chrome/Edge)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'Editor Project',
            accept: { 'application/x-edp': ['.edp'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      // User cancelled the dialog — don't fall through
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }

  // Fallback: trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
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

  if (interaction.debounceTimer) {
    clearTimeout(interaction.debounceTimer);
  }

  // Compare current state to pre-state
  const currentState = captureState();
  if (!currentState) { interaction = null; return; }
  const pre = interaction.preMetaSnapshot;

  // Only push if something actually changed
  const changed =
    statesChanged(pre, currentState);

  if (changed) {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      label: interaction.label,
      timestamp: Date.now(),
      kind: 'metadata',
      metaSnapshot: pre,
      estimatedSize: 0,
    };
    history.push(entry);
    markDirty();
  }

  interaction = null;
}

// ─── Discrete actions (toggle visibility, reorder, etc.) ────────────

/**
 * Flush any pending debounced action into the history stack immediately.
 * Called before undo/redo and interaction boundaries.
 */
function flushPendingAction(): void {
  if (!pendingAction) return;
  clearTimeout(pendingAction.timer);
  const currentState = captureState();
  if (currentState) {
    const changed =
      statesChanged(pendingAction.preSnapshot, currentState);
    if (changed) {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        label: pendingAction.label,
        timestamp: Date.now(),
        kind: 'metadata',
        metaSnapshot: pendingAction.preSnapshot,
        estimatedSize: 0,
      };
      history.push(entry);
      markDirty();
    }
  }
  pendingAction = null;
}

/**
 * Record a discrete action with 250ms debounce grouping.
 *
 * Rapid calls with the same label within 250ms are merged into a single
 * undo entry (e.g. toggling a checkbox repeatedly, or rapid crop adjustments).
 */
function recordAction(label: string, fn: () => void): void {
  // If there's a pending action with a DIFFERENT label, flush it first
  if (pendingAction && pendingAction.label !== label) {
    flushPendingAction();
  }

  // Capture pre-state only for the first call in this debounce window
  if (!pendingAction) {
    const pre = captureState();
    if (!pre) {
      fn(); // not initialized — action runs but no history entry
      return;
    }
    pendingAction = {
      label,
      preSnapshot: pre,
      timer: setTimeout(flushPendingAction, ACTION_DEBOUNCE_MS),
    };
  } else {
    // Same label — extend the debounce window
    clearTimeout(pendingAction.timer);
    pendingAction.timer = setTimeout(flushPendingAction, ACTION_DEBOUNCE_MS);
  }

  // Execute the mutation
  fn();
}

// ─── Destructive transactions ───────────────────────────────────────

async function beginTransaction(
  label: string,
  layerIds: string[],
): Promise<void> {
  await transaction.begin(label, layerIds);
}

async function commitTransaction(): Promise<void> {
  const info = transaction.commit();
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    label: info.label,
    timestamp: Date.now(),
    kind: 'destructive',
    metaSnapshot: info.preMetaSnapshot,
    pixelSnapshots: info.prePixelSnapshots,
    estimatedSize: 0,
  };
  history.push(entry);
  markDirty();
}

async function rollbackTransaction(): Promise<void> {
  await transaction.rollback();
}

// ─── Undo / redo ────────────────────────────────────────────────────

async function undoAction(): Promise<void> {
  // If there's an active transaction, rollback instead
  if (transaction.isActive()) {
    await transaction.rollback();
    return;
  }

  // Auto-commit any dangling interaction or pending action
  if (interaction) {
    endInteraction();
  }
  flushPendingAction();

  // Before undo, capture current state and swap it into the entry
  // so that redo can restore it
  const currentState = captureState();
  if (!currentState) return;
  const currentPixels = await capturePixelsForTopEntry();

  await history.undo();

  // Swap: the entry now on the redo stack has pre-state,
  // but for redo we need post-state. Patch it.
  const redoStack = history.getRedoStack();
  if (redoStack.length > 0) {
    const redoEntry = redoStack[redoStack.length - 1];
    // Store the post-state (what we just captured) in the redo entry
    redoEntry.metaSnapshot = currentState;
    if (currentPixels && redoEntry.kind === 'destructive') {
      redoEntry.pixelSnapshots = currentPixels;
    }
  }
}

async function redoAction(): Promise<void> {
  if (interaction) {
    endInteraction();
  }
  flushPendingAction();

  // Before redo, capture current state for the undo stack entry
  const currentState = captureState();
  if (!currentState) return;
  const currentPixels = await capturePixelsForUndoTop();

  await history.redo();

  // The entry pushed back to undo stack should have pre-state for future undo
  const undoStack = history.getUndoStack();
  if (undoStack.length > 0) {
    const undoEntry = undoStack[undoStack.length - 1];
    undoEntry.metaSnapshot = currentState;
    if (currentPixels && undoEntry.kind === 'destructive') {
      undoEntry.pixelSnapshots = currentPixels;
    }
  }
}

async function capturePixelsForTopEntry(): Promise<Map<string, Blob> | null> {
  const undoStack = history.getUndoStack();
  if (undoStack.length === 0) return null;
  const entry = undoStack[undoStack.length - 1];
  if (entry.kind !== 'destructive' || !entry.pixelSnapshots) return null;
  const layerIds = Array.from(entry.pixelSnapshots.keys());
  return pixelStore.captureSnapshots(layerIds);
}

async function capturePixelsForUndoTop(): Promise<Map<string, Blob> | null> {
  const redoStack = history.getRedoStack();
  if (redoStack.length === 0) return null;
  const entry = redoStack[redoStack.length - 1];
  if (entry.kind !== 'destructive' || !entry.pixelSnapshots) return null;
  const layerIds = Array.from(entry.pixelSnapshots.keys());
  return pixelStore.captureSnapshots(layerIds);
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
  useGraphStore.getState().setGraphPositions(manifest.graphPositions);

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
  recordAction,

  // Destructive transactions
  beginTransaction,
  commitTransaction,
  rollbackTransaction,

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
