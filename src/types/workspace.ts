export type Point = { x: number; y: number };
export type Size = { w: number; h: number };

export interface ImageNodeState {
  id: string;
  layerIds: string[];
  /**
   * User-editable display name shown in the image-node header. When unset,
   * the workspace mapper falls back to the first layer's name (file basename).
   */
  name?: string;
  position: Point;
  /**
   * Canvas-space layout box. Independent of the source bitmap dims so a 24MP
   * photo and a thumbnail render at the same workspace size. Width is the
   * resizable axis (aspect-locked to `sourceSize`); height is derived but
   * cached here so React Flow's layout / intersection math reads cleanly.
   */
  size: Size;
  /**
   * Source bitmap dimensions in pixels. Drives WebGL pipeline sizing and crop
   * coordinates; never changed by user resize.
   */
  sourceSize: Size;
  /**
   * ImageNode this one was extracted from (via the object-action "Extract
   * to Image Node"). Set at extract time; absent for the original/source
   * image-node and for anything added via the file picker. Drives the
   * "Rejoin source image" menu item which undoes the extract.
   */
  sourceImageNodeId?: string;
}

/**
 * Standalone "layers" node — one per image node. Renders the LayerStrip
 * (thumbnails + per-layer widget tether ports) as a moveable React Flow node
 * instead of a gutter baked into the image node. Content is fully derived from
 * the owning image node's `layerIds`; this record persists only the node's
 * canvas position (and last-measured size, used for tether-edge routing).
 *
 * Deterministic id `layers-<imageNodeId>` keeps it 1:1 with its image node, so
 * lifecycle (create/remove/split/merge) cascades straight off image-node ops
 * with no lookup and no separate id counter.
 */
export interface LayerNodeState {
  id: string;
  imageNodeId: string;
  position: Point;
  /** Last React-Flow-measured canvas size, persisted so the widget-tether and
   *  attribution edges route to the node's real extent. Absent until measured. */
  size?: Size;
}

/**
 * Break-out projection satellite — a frontend-only view of ONE op-node slice of
 * a fused (widget-local `compound`) parent widget, pinned to the canvas.
 *
 * The satellite is NOT a backend Widget: it looks up its parent widget in the
 * snapshot and renders that op's real controls via `sliceWidgetByOp`. Every edit
 * routes to `set_widget_param(parentWidgetId, …)`, so the backend never learns a
 * satellite exists — pinning, refine, and undo all fall out of the parent's own
 * flow. Closing a satellite is pure UI (`removeFusedSliceNode`); dismissing the
 * parent widget (or detaching the op node) prunes the satellite at render time.
 *
 * Slices are per-NODE (like the extract flow): one satellite per op-graph node.
 * Deterministic id `slice:<parentWidgetId>:<nodeId>` keeps it 1:1 with its
 * parent op node, so a second ⤢ click focuses the existing satellite instead of
 * spawning a duplicate.
 */
export interface FusedSliceNodeState {
  /** Deterministic: `slice:<parentWidgetId>:<nodeId>`. */
  id: string;
  /** The fused parent widget this satellite projects. */
  parentWidgetId: string;
  /** The parent widget's op-graph node id this satellite slices out. */
  nodeId: string;
  position: Point;
  /** Last React-Flow-measured canvas size, persisted so the hub tether routes
   *  to the satellite's real extent. Absent until measured. */
  size?: Size;
}

export interface WidgetNodeState {
  id: string;
  position: Point;
  /** Last React-Flow-measured canvas size, persisted so spawn-placement
   *  collision can avoid the widget's REAL (expanded) footprint instead of a
   *  fixed header estimate. Absent until the widget has been measured once. */
  size?: Size;
  /** User-set uniform scale (bottom-right corner resize). 1 = natural size.
   *  Absent ⇒ 1. Scales the whole widget as a unit (ratio locked). */
  scale?: number;
}

// ─── Info widgets ──────────────────────────────────────────────────────

/** Single pinned data point in an info widget — typically a chip the user
 *  promoted from the Info tab. Value is **frozen** at pin-time so the
 *  widget keeps showing what the user saw, even if the underlying source
 *  (mechanical histogram, AI context, EXIF) updates later. */
export interface InfoPinnedItem {
  /** Stable id within the parent info node, used for keys + removal. */
  id: string;
  label: string;
  value: string;
  /** Optional source key (e.g. 'mech:median_luma', 'doc:resolution'). Lets
   *  a future "refresh" action re-resolve to a live value. */
  sourceId?: string;
}

/** Histogram payload for kind: 'histogram'. All four channels are 256-bin
 *  arrays; missing channels are simply omitted at pin time. */
export interface InfoHistogramPayload {
  r?: number[];
  g?: number[];
  b?: number[];
  lum: number[];
}

/** Color palette payload — pre-computed swatches with weights. */
export interface InfoPalettePayload {
  swatches: { rgb: [number, number, number]; weight: number }[];
}

/** Color-cast payload (Lab a-star / b-star + strength), frozen at pin time. */
export interface InfoCastPayload {
  a: number;
  b: number;
  strength: number;
}

/** Discriminated content union — each kind gets a typed payload. The
 *  `'stats'` kind keeps the original chip-grid shape so per-chip pinning
 *  doesn't change behaviour. */
export type InfoNodeContent =
  | { kind: 'stats';     items: InfoPinnedItem[] }
  | { kind: 'histogram'; bins:  InfoHistogramPayload }
  | { kind: 'palette';   palette: InfoPalettePayload }
  | { kind: 'cast';      cast:  InfoCastPayload };

/** A canvas-pinned info widget. Frontend-only — never round-trips through
 *  the backend `operation_graph` because it doesn't touch pixels. Lives in
 *  `WorkspaceSlice.infoNodes`, gets captured by `SerializableState` so
 *  undo/redo restores it. */
export interface InfoNodeState {
  id: string;
  position: Point;
  /** Display box on the workspace canvas. Width is the resizable axis;
   *  height grows with content. */
  size: Size;
  /** Optional user-editable title; falls back to a kind-derived default. */
  title?: string;
  /** Discriminated content — defines what the widget body renders + which
   *  payload it carries. `kind` lives on `content` so TypeScript can narrow
   *  in the renderer without extra checks. */
  content: InfoNodeContent;
  /** Image node this widget belongs to. Drawn as a tether edge on the
   *  workspace so the relationship is visible. Captured at pin time from
   *  the active image node; absent for legacy nodes / programmatic pins
   *  without a target (no tether is rendered then). */
  targetImageNodeId?: string;
}

export interface TetherEdgeState {
  id: string;
  widgetNodeId: string;
  targetImageNodeId: string;
  /** The specific layer this tether lands on (the rail thumbnail handle).
   *  One edge per (widget, layer) target — a widget replicated across N layers
   *  has N tether edges. Mirrors an entry in the widget's node `layerIds`. */
  layerId: string;
  scope:
    | { kind: 'layer'; layerId: string }
    | { kind: 'node' };
}

export interface WorkspaceViewport {
  zoom: number;
  pan: Point;
}
