import type { Layer } from '@/store/layer-slice';
import type { NodePosition } from '@/types/graph';

// ─── Document metadata ──────────────────────────────────────────────

export interface DocumentMeta {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  width: number;
  height: number;
}

// ─── Serializable state snapshot ────────────────────────────────────

/** The subset of Zustand state captured for undo/redo snapshots. */
export interface SerializableState {
  layers: Layer[];
  activeLayerId: string | null;
  pixelVersion: number;
  graphPositions: Record<string, NodePosition>;
}

// ─── Serializable adjustment params (for .edp JSON) ─────────────────

/** Float32Array → number[] for JSON serialization in .edp files. */
export type SerializableParams = Record<string, number | number[]>;

// ─── History ────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  kind: 'metadata' | 'destructive';
  /** State BEFORE this action was applied. */
  metaSnapshot: SerializableState;
  /** Pixel snapshots BEFORE this action (destructive only). */
  pixelSnapshots?: Map<string, Blob>;
  /** Estimated memory usage in bytes. */
  estimatedSize: number;
}

// ─── Transactions ───────────────────────────────────────────────────

export interface TransactionInfo {
  label: string;
  affectedLayerIds: string[];
  preMetaSnapshot: SerializableState;
  prePixelSnapshots: Map<string, Blob>;
}

// ─── Interaction sessions (slider debouncing) ───────────────────────

export interface InteractionSession {
  label: string;
  preMetaSnapshot: SerializableState;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

// ─── Tree-structured history ────────────────────────────────────────

/**
 * A node in the history tree. Each node captures the state AFTER its action
 * was applied (post-state). The root node represents the initial state of
 * the document (no action) and has `parentId: null`.
 */
export interface HistoryNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  label: string;
  timestamp: number;
  kind: 'metadata' | 'destructive' | 'root';
  /** Post-state metadata snapshot (state AFTER the action). */
  metaSnapshot: SerializableState;
  /** Pixel snapshots taken BEFORE the action (destructive only). */
  pixelSnapshots?: Map<string, Blob>;
  /** Optional user-facing milestone label (set via `setMilestone`). */
  milestoneLabel?: string;
  /** Estimated memory usage in bytes (used by eviction). */
  estimatedSize: number;
}

/**
 * Persistable snapshot of the entire history tree. Used by serializer +
 * session-storage. Blobs survive IndexedDB round-trips natively; for `.edp`
 * the serializer converts them to PNG entries under `history/<nodeId>/<layerId>.png`.
 */
export interface HistoryTreeSnapshot {
  /** Map of node ID → node (children stored by ID for cheap JSON). */
  nodes: Record<string, Omit<HistoryNode, 'pixelSnapshots'> & {
    /** Layer IDs that have a stored blob — actual Blob lives outside the JSON. */
    pixelLayerIds?: string[];
  }>;
  rootId: string;
  currentNodeId: string;
  /** Name of the branch the user is currently extending. Defaults to 'main'. */
  currentBranch: string;
  /** Named branch heads. `main` always exists. */
  branchHeads: Record<string, string>;
}
