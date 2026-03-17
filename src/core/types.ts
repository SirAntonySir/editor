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
