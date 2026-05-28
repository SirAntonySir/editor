/**
 * HistoryManager — tree-structured undo/redo with named branches.
 */
import { createStore } from 'zustand/vanilla';
import type {
  HistoryEntry,
  HistoryNode,
  SerializableState,
} from './types';
import { pixelStore } from './pixel-store';
import * as tree from './history-tree';

const MAX_ENTRIES = 50;
const MAX_MEMORY_BYTES = 500 * 1024 * 1024; // 500 MB

export interface HistoryStoreState {
  canUndo: boolean;
  canRedo: boolean;
  entries: HistoryNode[];
  currentIndex: number;
  isRestoring: boolean;
  currentNodeId: string;
  rootId: string;
  branchHeads: Record<string, string>;
}

export const historyStore = createStore<HistoryStoreState>(() => ({
  canUndo: false, canRedo: false, entries: [], currentIndex: -1,
  isRestoring: false, currentNodeId: '', rootId: '', branchHeads: {},
}));

let state: tree.HistoryTree | null = null;
let restoreCallback: ((snapshot: SerializableState) => void) | null = null;

function estimateEntrySize(entry: HistoryEntry): number {
  let size = 4096;
  const pre = entry.prePixels;
  if (pre) for (const blob of pre.values()) size += blob.size;
  if (entry.postPixels) for (const blob of entry.postPixels.values()) size += blob.size;
  return size;
}

function syncStore(): void {
  if (!state) {
    historyStore.setState({
      canUndo: false, canRedo: false, entries: [], currentIndex: -1,
      currentNodeId: '', rootId: '', branchHeads: {},
    });
    return;
  }
  const path = tree.getCurrentPath(state);
  const entriesWithoutRoot = path.slice(1);
  historyStore.setState({
    canUndo: tree.canUndo(state),
    canRedo: tree.canRedo(state),
    entries: entriesWithoutRoot,
    currentIndex: entriesWithoutRoot.length - 1,
    currentNodeId: state.currentNodeId,
    rootId: state.rootId,
    branchHeads: Object.fromEntries(state.branchHeads),
  });
}

function ensureInitialized(initialState?: SerializableState): tree.HistoryTree {
  if (state) return state;
  const seed = initialState ?? {
    layers: [], activeLayerId: null, pixelVersion: 0,
  };
  state = tree.createTree(seed);
  return state;
}

export function setRestoreCallback(
  cb: (snapshot: SerializableState) => void,
): void { restoreCallback = cb; }

export function push(entry: HistoryEntry): void {
  const t = ensureInitialized(entry.metaSnapshot);
  state = tree.append(t, {
    label: entry.label,
    timestamp: entry.timestamp,
    kind: entry.kind,
    metaSnapshot: entry.metaSnapshot,
    prePixels: entry.prePixels,
    postPixels: entry.postPixels,
    estimatedSize: estimateEntrySize(entry),
  });
  state = tree.evict(state, { maxEntries: MAX_ENTRIES, maxBytes: MAX_MEMORY_BYTES });
  syncStore();
}

export async function undo(): Promise<void> {
  if (!state || !restoreCallback || historyStore.getState().isRestoring) return;
  if (!tree.canUndo(state)) return;
  historyStore.setState({ isRestoring: true });
  try {
    // We're undoing AWAY from `leaving`; its prePixels reflect the state BEFORE that action.
    const leaving = state.nodes.get(state.currentNodeId);
    state = tree.undo(state);
    const arrived = state.nodes.get(state.currentNodeId)!;
    restoreCallback(arrived.metaSnapshot);
    if (leaving?.kind === 'destructive' && leaving.prePixels) {
      await pixelStore.restoreSnapshots(leaving.prePixels);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}

export async function redo(): Promise<void> {
  if (!state || !restoreCallback || historyStore.getState().isRestoring) return;
  if (!tree.canRedo(state)) return;
  historyStore.setState({ isRestoring: true });
  try {
    state = tree.redo(state);
    const node = state.nodes.get(state.currentNodeId)!;
    restoreCallback(node.metaSnapshot);
    if (node.kind === 'destructive' && node.postPixels) {
      await pixelStore.restoreSnapshots(node.postPixels);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}

export function clear(): void { state = null; syncStore(); }

/**
 * Seed the tree with the initial document state as its root. Call from
 * lifecycle entry points (newDocument, openImage, openEdp, restoreSession)
 * after the Zustand store is populated. Without this, the first push() would
 * synthesise a root holding the post-state, and the first undo would be a no-op.
 */
export function initWith(initialState: SerializableState): void {
  state = tree.createTree(initialState);
  syncStore();
}

export function branchFrom(nodeId: string, name: string): void {
  if (!state) return;
  state = tree.branchFrom(state, nodeId, name);
  syncStore();
}

export function switchBranch(name: string): void {
  if (!state || !restoreCallback) return;
  state = tree.switchBranch(state, name);
  const node = state.nodes.get(state.currentNodeId)!;
  restoreCallback(node.metaSnapshot);
  syncStore();
}

export function setMilestone(nodeId: string, label: string): void {
  if (!state) return;
  state = tree.setMilestone(state, nodeId, label);
  syncStore();
}

export function jumpTo(nodeId: string): void {
  if (!state || !restoreCallback) return;
  const node = state.nodes.get(nodeId);
  if (!node) return;
  state = { ...state, currentNodeId: nodeId };
  restoreCallback(node.metaSnapshot);
  syncStore();
}

export function getTree(): tree.HistoryTree | null { return state; }

export function loadTree(t: tree.HistoryTree): void {
  state = t;
  syncStore();
}

export function getCurrentPathNodes(): HistoryNode[] {
  if (!state) return [];
  return tree.getCurrentPath(state);
}
