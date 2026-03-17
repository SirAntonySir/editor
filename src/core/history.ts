/**
 * HistoryManager — unified undo/redo for metadata AND pixels.
 * Replaces both zundo and PixelHistoryManager.
 */
import { createStore } from 'zustand/vanilla';
import type { HistoryEntry, SerializableState } from './types';
import { pixelStore } from './pixel-store';

const MAX_ENTRIES = 50;
const MAX_MEMORY_BYTES = 500 * 1024 * 1024; // 500 MB

// ─── Reactive store for UI subscriptions ────────────────────────────

export interface HistoryStoreState {
  canUndo: boolean;
  canRedo: boolean;
  entries: HistoryEntry[];
  currentIndex: number; // index of most recent undo entry (-1 = no history)
  isRestoring: boolean;
}

export const historyStore = createStore<HistoryStoreState>(() => ({
  canUndo: false,
  canRedo: false,
  entries: [],
  currentIndex: -1,
  isRestoring: false,
}));

// ─── Internal state ─────────────────────────────────────────────────

let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];
let totalMemory = 0;
let restoreCallback: ((snapshot: SerializableState) => void) | null = null;

function estimateEntrySize(entry: HistoryEntry): number {
  let size = 4096; // base overhead for metadata JSON
  if (entry.pixelSnapshots) {
    for (const blob of entry.pixelSnapshots.values()) {
      size += blob.size;
    }
  }
  return size;
}

function syncStore(): void {
  historyStore.setState({
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    entries: [...undoStack],
    currentIndex: undoStack.length - 1,
  });
}

function evictOldest(): void {
  while (
    (undoStack.length > 5 && totalMemory > MAX_MEMORY_BYTES) ||
    undoStack.length > MAX_ENTRIES
  ) {
    const removed = undoStack.shift();
    if (removed) {
      totalMemory -= removed.estimatedSize;
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export function setRestoreCallback(
  cb: (snapshot: SerializableState) => void,
): void {
  restoreCallback = cb;
}

export function push(entry: HistoryEntry): void {
  entry.estimatedSize = estimateEntrySize(entry);
  undoStack.push(entry);
  totalMemory += entry.estimatedSize;

  // Clear redo on new action
  for (const re of redoStack) {
    totalMemory -= re.estimatedSize;
  }
  redoStack = [];

  evictOldest();
  syncStore();
}

export async function undo(): Promise<void> {
  if (undoStack.length === 0 || !restoreCallback) return;
  if (historyStore.getState().isRestoring) return;

  historyStore.setState({ isRestoring: true });
  try {
    const entry = undoStack.pop()!;

    // Capture current state for redo (we need the caller to provide this)
    // The document facade handles capturing current state before calling undo
    redoStack.push(entry);

    // Restore metadata
    restoreCallback(entry.metaSnapshot);

    // Restore pixels if destructive
    if (entry.pixelSnapshots) {
      await pixelStore.restoreSnapshots(entry.pixelSnapshots);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}

export async function redo(): Promise<void> {
  if (redoStack.length === 0 || !restoreCallback) return;
  if (historyStore.getState().isRestoring) return;

  historyStore.setState({ isRestoring: true });
  try {
    const entry = redoStack.pop()!;
    undoStack.push(entry);

    // For redo, we need to restore the state that existed AFTER the action.
    // entry.metaSnapshot is the state BEFORE the action.
    // The state AFTER is the metaSnapshot of the NEXT entry (now at top of undo stack),
    // or if this was the last entry, it's the state captured in the next redo entry.
    //
    // Since we push the entry back to undoStack, we need the "post-state" of this action.
    // This is actually the metaSnapshot of the entry that comes after this one on the undo stack.
    // If there IS a next entry, its metaSnapshot is the post-state.
    // If there ISN'T, the post-state was the live state before the first undo — which we don't have.
    //
    // To handle this correctly, we swap the approach:
    // When undo is called, we swap the entry's metaSnapshot with the current state.
    // So the entry on the redo stack has the POST-state, not the PRE-state.
    // This is handled in the document facade's undo/redo methods.

    restoreCallback(entry.metaSnapshot);

    if (entry.pixelSnapshots) {
      await pixelStore.restoreSnapshots(entry.pixelSnapshots);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}

export function clear(): void {
  undoStack = [];
  redoStack = [];
  totalMemory = 0;
  syncStore();
}

export function getUndoStack(): readonly HistoryEntry[] {
  return undoStack;
}

export function getRedoStack(): readonly HistoryEntry[] {
  return redoStack;
}
