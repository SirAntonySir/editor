import type { Layer } from '@/store/layer-slice';
import type {
  ImageNodeState,
  InfoNodeState,
  LayerNodeState,
  TetherEdgeState,
  WidgetNodeState,
} from '@/types/workspace';
import type { ImageMetadata } from '@/lib/image-metadata';

// ─── Document metadata ──────────────────────────────────────────────

export interface DocumentMeta {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  width: number;
  height: number;
  /** Source file MIME type (e.g. "image/jpeg"). Drives the File chip in the
   *  Info tab. Captured at openImage from the File object. */
  mimeType?: string;
  /** Display format label override (e.g. "ARW", "RAW"). Set when the on-disk
   *  source differs from the decoded bytes — a camera RAW is developed to a
   *  PNG internally, but should still read as its RAW format. Preferred over
   *  the `mimeType`-derived label. */
  format?: string;
  /** Source file size in bytes. Pure informational — never used for any
   *  pipeline decision. */
  fileSize?: number;
  /** Parsed EXIF + GPS, when the source file carried any. Absent when the
   *  image has no EXIF (raw bitmap, screenshot, etc.). The Info tab's
   *  Metadata section reads this directly. */
  metadata?: ImageMetadata;
}

// ─── Serializable state snapshot ────────────────────────────────────

/**
 * The subset of Zustand state captured for undo/redo snapshots.
 *
 * Note: `expandedWidgetIds` is intentionally excluded — it's a UI-only
 * collapsed/expanded toggle that shouldn't produce undo entries.
 */
export interface SerializableState {
  layers: Layer[];
  activeLayerId: string | null;
  pixelVersion: number;

  // Workspace fields — image nodes, widget node positions, and tether
  // edges form the canvas-workspace graph and participate in undo/redo.
  imageNodes: Record<string, ImageNodeState>;
  widgetNodes: Record<string, WidgetNodeState>;
  tetherEdges: Record<string, TetherEdgeState>;
  /** Frontend-only info widgets pinned to the canvas (chips, palette
   *  snapshots, etc.). Captured here so undo/redo rolls them. Don't touch
   *  pixels; never round-trip through the backend operation_graph. */
  infoNodes: Record<string, InfoNodeState>;
  /** Standalone layers nodes (position per image node). Captured so undo/redo
   *  rolls a moved/created/removed layers node with its image-node op. */
  layerNodes: Record<string, LayerNodeState>;
  activeImageNodeId: string | null;
}

// ─── Serializable adjustment params ─────────────────────────────────

/** Float32Array → number[] for JSON serialization. */
export type SerializableParams = Record<string, number | number[]>;

// ─── History ────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  kind: 'metadata' | 'destructive';
  /** State BEFORE this action was applied. */
  metaSnapshot: SerializableState;
  /** PRE-action pixels per layer (used when undoing AWAY from the resulting node). */
  prePixels?: Map<string, Blob>;
  /** POST-action pixels per layer (used when redoing TO the resulting node). */
  postPixels?: Map<string, Blob>;
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
  /** PRE-action pixels per layer (used when undoing AWAY from this node). */
  prePixels?: Map<string, Blob>;
  /** POST-action pixels per layer (used when redoing TO this node). */
  postPixels?: Map<string, Blob>;
  /** Optional user-facing milestone label (set via `setMilestone`). */
  milestoneLabel?: string;
  /** Estimated memory usage in bytes (used by eviction). */
  estimatedSize: number;
}
