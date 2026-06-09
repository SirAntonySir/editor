export type Point = { x: number; y: number };
export type Size = { w: number; h: number };

export interface ImageNodeState {
  id: string;
  layerIds: string[];
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
}

export interface WidgetNodeState {
  id: string;
  position: Point;
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
  scope:
    | { kind: 'layer'; layerId: string }
    | { kind: 'node' };
}

export interface WorkspaceViewport {
  zoom: number;
  pan: Point;
}
