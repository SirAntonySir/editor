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
import { pixelStore } from './pixel-store';
import * as history from './history';
import * as transaction from './transaction';
import * as serializer from './serializer';

type EditorStore = StoreApi<Record<string, unknown>>;

const DEBOUNCE_MS = 2000;

let store: EditorStore | null = null;
let documentMeta: DocumentMeta | null = null;
let isDirty = false;
let filePath: string | null = null;
let interaction: InteractionSession | null = null;
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

// ─── State capture / restore ────────────────────────────────────────

function captureState(): SerializableState | null {
  if (!store) return null;
  const s = store.getState() as Record<string, unknown>;
  return {
    layers: structuredClone(s.layers as SerializableState['layers']),
    activeLayerId: s.activeLayerId as string | null,
    pixelVersion: s.pixelVersion as number,
    graphPositions: structuredClone(
      (s.graphPositions as SerializableState['graphPositions']) ?? {},
    ),
  };
}

function restoreState(snapshot: SerializableState): void {
  if (!store) return;
  store.setState({
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    pixelVersion: snapshot.pixelVersion,
    graphPositions: snapshot.graphPositions,
  });
}

function markDirty(): void {
  isDirty = true;
  if (store) {
    store.setState({ isDirty: true });
  }
}

function markClean(): void {
  isDirty = false;
  if (store) {
    store.setState({ isDirty: false });
  }
}

// ─── Initialization ─────────────────────────────────────────────────

function init(zustandStore: EditorStore): void {
  store = zustandStore;

  // Wire up history restore callback
  history.setRestoreCallback(restoreState);

  // Wire up transaction callbacks
  transaction.setTransactionCallbacks(captureState, restoreState);

  // beforeunload guard
  beforeUnloadHandler = (e: BeforeUnloadEvent) => {
    if (isDirty) {
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);
}

function dispose(): void {
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
  store = null;
}

// ─── Document lifecycle ─────────────────────────────────────────────

function newDocument(): void {
  pixelStore.clear();
  history.clear();
  documentMeta = {
    id: crypto.randomUUID(),
    name: 'Untitled',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    width: 0,
    height: 0,
  };
  filePath = null;
  markClean();
  if (store) {
    store.setState({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      graphPositions: {},
      documentMeta,
    });
  }
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

  documentMeta = {
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
      graphPositions: {},
      documentMeta,
      isDirty: false,
    });
  }

  filePath = null;
  isDirty = false;
  bitmap.close();
}

async function openEdp(file: File): Promise<void> {
  const result = await serializer.load(file);

  history.clear();
  documentMeta = result.meta;

  if (store) {
    store.setState({
      layers: result.layers,
      activeLayerId: result.activeLayerId,
      pixelVersion: 0,
      graphPositions: result.graphPositions,
      zoom: result.viewport.zoom,
      panX: result.viewport.panX,
      panY: result.viewport.panY,
      fitMode: result.viewport.fitMode,
      documentMeta: result.meta,
      isDirty: false,
    });
  }

  filePath = file.name;
  isDirty = false;
}

async function save(): Promise<Blob | null> {
  if (!store || !documentMeta) return null;
  const s = store.getState() as Record<string, unknown>;

  documentMeta.modifiedAt = Date.now();

  const blob = await serializer.save({
    meta: documentMeta,
    layers: s.layers as serializer.SaveOptions['layers'],
    activeLayerId: s.activeLayerId as string | null,
    graphPositions:
      (s.graphPositions as serializer.SaveOptions['graphPositions']) ?? {},
    viewport: {
      zoom: (s.zoom as number) ?? 1,
      panX: (s.panX as number) ?? 0,
      panY: (s.panY as number) ?? 0,
      fitMode: (s.fitMode as string) ?? 'fit',
    },
  });

  markClean();
  return blob;
}

async function saveAs(name?: string): Promise<void> {
  const blob = await save();
  if (!blob) return;

  const fileName = name ?? `${documentMeta?.name ?? 'document'}.edp`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  filePath = fileName;
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
    JSON.stringify(pre.layers) !== JSON.stringify(currentState.layers) ||
    pre.activeLayerId !== currentState.activeLayerId ||
    pre.pixelVersion !== currentState.pixelVersion;

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

function recordAction(label: string, fn: () => void): void {
  const pre = captureState();
  fn();
  if (!pre) return; // not initialized — action runs but no history entry
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    label,
    timestamp: Date.now(),
    kind: 'metadata',
    metaSnapshot: pre,
    estimatedSize: 0,
  };
  history.push(entry);
  markDirty();
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

  // Auto-commit any dangling interaction
  if (interaction) {
    endInteraction();
  }

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

  // State
  get isDirty() {
    return isDirty;
  },
  get meta() {
    return documentMeta;
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
