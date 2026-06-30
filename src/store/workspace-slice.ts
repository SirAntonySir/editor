import type { StateCreator } from 'zustand';
import type {
  ImageNodeState,
  InfoNodeContent,
  InfoNodeState,
  Point,
  Size,
  TetherEdgeState,
  WidgetNodeState,
  WorkspaceViewport,
} from '@/types/workspace';
import { UI } from '@/config';

/** Default source dims when the caller doesn't pass any (e.g. unit tests). */
const DEFAULT_SOURCE_SIZE: Size = { w: 240, h: 180 };

/**
 * Canvas-space width for a newly-created image node. Independent of source
 * pixel dims so every image enters the workspace at the same visual size.
 * Height is derived from this width × source aspect ratio.
 */
const DEFAULT_IMAGE_NODE_DISPLAY_WIDTH = UI.imageNodeDisplayWidthDefault;

/** Lower / upper bounds for interactive resize. Aspect-locked, so only the
 *  width axis is bounded here; height follows. */
export const IMAGE_NODE_MIN_DISPLAY_WIDTH = UI.imageNodeDisplayWidthMin;
export const IMAGE_NODE_MAX_DISPLAY_WIDTH = UI.imageNodeDisplayWidthMax;

const SPLIT_GAP_PX = UI.splitGapPx;

function deriveDisplaySize(sourceSize: Size, displayWidth: number): Size {
  const aspect = sourceSize.h > 0 ? sourceSize.w / sourceSize.h : 1;
  return { w: displayWidth, h: displayWidth / aspect };
}

/** Reasonable default canvas size per info-widget kind. Height is a hint
 *  (shells size to content); width matters more for visual widgets where
 *  bars / plots want a minimum readable strip. */
function defaultSizeFor(kind: InfoNodeContent['kind']): Size {
  switch (kind) {
    case 'histogram': return { w: UI.infoWidgetHistogramW, h: UI.infoWidgetHistogramH };
    case 'palette':   return { w: UI.infoWidgetPaletteW,   h: UI.infoWidgetPaletteH };
    case 'cast':      return { w: UI.infoWidgetCastW,      h: UI.infoWidgetCastH };
    case 'stats':     return { w: UI.infoWidgetStatsW,     h: UI.infoWidgetStatsH };
  }
}

/** Deep-clone the discriminated content union so the store never holds a
 *  live alias to the caller's payload (which might be a slice of a larger
 *  mutable object somewhere in the app). */
function cloneContent(c: InfoNodeContent): InfoNodeContent {
  switch (c.kind) {
    case 'stats':
      return { kind: 'stats', items: c.items.map((i) => ({ ...i })) };
    case 'histogram':
      return {
        kind: 'histogram',
        bins: {
          r:   c.bins.r ? [...c.bins.r] : undefined,
          g:   c.bins.g ? [...c.bins.g] : undefined,
          b:   c.bins.b ? [...c.bins.b] : undefined,
          lum: [...c.bins.lum],
        },
      };
    case 'palette':
      return {
        kind: 'palette',
        palette: { swatches: c.palette.swatches.map((s) => ({ ...s, rgb: [...s.rgb] as [number, number, number] })) },
      };
    case 'cast':
      return { kind: 'cast', cast: { ...c.cast } };
  }
}

export interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetNodes: Record<string, WidgetNodeState>;
  tetherEdges: Record<string, TetherEdgeState>;
  /** Frontend-only info widgets pinned to the canvas (chips, stat cards). */
  infoNodes: Record<string, InfoNodeState>;
  workspaceViewport: WorkspaceViewport;
  activeImageNodeId: string | null;
  /**
   * Last `activeImageNodeId` that was distinct from the current one. Updated
   * by `setActiveImageNode` whenever the active node changes to a different
   * non-null value. Used by the ImageNode header "Merge into previous" affordance
   * so the user can fold the current node into the one they were just on.
   *
   * NOT part of the backend snapshot; UI-only.
   */
  previousImageNodeId: string | null;

  /** Per-ImageNode UI-only display mode. Absent ⇒ caller's default
   *  (typically 'objects' when candidateRegions exist, else 'layers').
   *  UI-only; not part of the snapshot SSoT. */
  imageNodeMode: Record<string, 'layers' | 'objects'>;

  /** Private id sequences. Reset by `resetWorkspace`. */
  _nextNodeSeq: number;
  _nextEdgeSeq: number;

  /**
   * Create an image node.
   * @param sourceSize  source bitmap dimensions in pixels. Used by the WebGL
   *                    pipeline and to derive the initial display height.
   *                    Defaults to a placeholder if omitted (test fixtures).
   */
  addImageNode: (
    layerIds: string[],
    position?: Point,
    sourceSize?: Size,
    /** Optional provenance — set by the extract-to-image-node flow so the
     *  resulting node can offer "Rejoin source image" to undo the extract. */
    sourceImageNodeId?: string,
  ) => string;
  /**
   * Resize an image node's canvas-space box. Aspect-locked to its source dims:
   * caller specifies the new width; height is recomputed. Clamped to
   * [IMAGE_NODE_MIN_DISPLAY_WIDTH, IMAGE_NODE_MAX_DISPLAY_WIDTH].
   */
  setImageNodeDisplayWidth: (id: string, width: number) => void;
  /**
   * Set or clear an image node's user-editable display name. Empty/whitespace
   * strings clear the override and fall back to the first layer's name.
   */
  setImageNodeName: (id: string, name: string) => void;
  /**
   * Peel a single layer off `sourceId`, place it on a new image node, and return the new node's id.
   * Source node survives (minus the migrated layer). Tether edges whose
   * `targetImageNodeId === sourceId` AND whose scope is `{ kind: 'layer', layerId: layerIdToSplit }`
   * are redirected to the new node id. All other edges remain on the source.
   * Returns `null` if the source does not exist or does not contain the layer.
   */
  splitImageNode: (sourceId: string, layerIdToSplit: string) => string | null;
  /**
   * Append source's layerIds to target's, delete the source node, and redirect every tether edge
   * whose `targetImageNodeId === sourceId` to `targetId` (scope preserved). Target keeps its id.
   */
  mergeImageNodes: (sourceId: string, targetId: string) => void;
  /**
   * Delete an image node by id. Cascades: any tether edge whose `targetImageNodeId === id`
   * is removed. Clears `activeImageNodeId` if it matched.
   */
  removeImageNode: (id: string) => void;
  /**
   * Re-derive the private node-id counter from the ids currently in the store
   * so freshly minted ids can't collide with existing ones. Call after any
   * bulk restore (session reload, history undo/redo) that repopulates
   * `imageNodes`/`infoNodes` without carrying `_nextNodeSeq` — otherwise the
   * counter resets to 1 and the next `addImageNode` overwrites a restored node
   * (e.g. Extract-to-Image-Node clobbering the source node after a reload).
   */
  resyncNodeSeq: () => void;
  setNodePosition: (id: string, position: Point) => void;
  /** Creates the entry if it does not yet exist. */
  setWidgetPosition: (id: string, position: Point) => void;
  /** Persist the widget's React-Flow-measured canvas size. No-op if the widget
   *  node doesn't exist yet (only positioned widgets need a collision footprint). */
  setWidgetSize: (id: string, size: Size) => void;
  /**
   * Insert or replace an edge by `edge.id`. The caller owns the id.
   */
  setEdge: (edge: TetherEdgeState) => void;
  unbindEdge: (edgeId: string) => void;
  /**
   * Mirror the currently active image node id derived from selection-slice.
   * The workspace slice does not own selection state.
   */
  setActiveImageNode: (activeImageNodeId: string | null) => void;
  setImageNodeMode: (id: string, mode: 'layers' | 'objects') => void;
  setWorkspaceViewport: (v: WorkspaceViewport) => void;

  // ─── Info widgets (chips / stat cards / visualisations on the canvas) ──
  /**
   * Create a frontend-only info widget at the given position. The
   * `content` arg is a discriminated union: 'stats' for chip grids,
   * 'histogram' / 'palette' / 'cast' for visual snapshots. All payloads
   * are frozen at pin time — the widget keeps showing what the user saw
   * even if the underlying mechanical context drifts.
   */
  addInfoNode: (
    content: InfoNodeContent,
    options?: {
      position?: Point;
      size?: Size;
      title?: string;
      /** Image node this widget tethers to. Drawn as an edge on the
       *  workspace. Omit to spawn an untethered widget. */
      targetImageNodeId?: string;
    },
  ) => string;
  /** Move an info widget to a new canvas position (drag-stop persists here). */
  setInfoNodePosition: (id: string, position: Point) => void;
  /** Replace an info widget's content or title (e.g. when the user adds
   *  another chip to an existing 'stats' widget). */
  updateInfoNode: (id: string, patch: Partial<Pick<InfoNodeState, 'content' | 'title' | 'size'>>) => void;
  /** Delete an info widget by id. */
  removeInfoNode: (id: string) => void;

  resetWorkspace: () => void;
}

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [['zustand/immer', never]], []> = (set) => ({
  imageNodes: {},
  widgetNodes: {},
  tetherEdges: {},
  infoNodes: {},
  workspaceViewport: { zoom: 1, pan: { x: 0, y: 0 } },
  activeImageNodeId: null,
  previousImageNodeId: null,
  imageNodeMode: {},
  _nextNodeSeq: 1,
  _nextEdgeSeq: 1,

  addImageNode: (layerIds, position = { x: 0, y: 0 }, sourceSize, sourceImageNodeId) => {
    let id = '';
    set((state) => {
      id = `in-${state._nextNodeSeq++}`;
      const src = sourceSize ? { ...sourceSize } : { ...DEFAULT_SOURCE_SIZE };
      state.imageNodes[id] = {
        id,
        layerIds: [...layerIds],
        position,
        sourceSize: src,
        size: deriveDisplaySize(src, DEFAULT_IMAGE_NODE_DISPLAY_WIDTH),
        ...(sourceImageNodeId ? { sourceImageNodeId } : {}),
      };
    });
    return id;
  },

  setImageNodeDisplayWidth: (id, width) =>
    set((state) => {
      const n = state.imageNodes[id];
      if (!n) return;
      const clamped = Math.min(
        IMAGE_NODE_MAX_DISPLAY_WIDTH,
        Math.max(IMAGE_NODE_MIN_DISPLAY_WIDTH, width),
      );
      n.size = deriveDisplaySize(n.sourceSize, clamped);
    }),

  setImageNodeName: (id, name) =>
    set((state) => {
      const n = state.imageNodes[id];
      if (!n) return;
      const trimmed = name.trim();
      if (trimmed) n.name = trimmed;
      else delete n.name;
    }),

  splitImageNode: (sourceId, layerIdToSplit) => {
    let newId: string | null = null;
    set((state) => {
      const src = state.imageNodes[sourceId];
      if (!src) return;
      if (!src.layerIds.includes(layerIdToSplit)) return;
      newId = `in-${state._nextNodeSeq++}`;
      // Remove the layer from the source.
      src.layerIds = src.layerIds.filter((lid) => lid !== layerIdToSplit);
      // Place the peeled layer on a new node positioned next to the source.
      // Inherit the source's size — the peeled layer belongs to the same
      // document, so it shares the source image's intrinsic dimensions.
      state.imageNodes[newId] = {
        id: newId,
        layerIds: [layerIdToSplit],
        position: { x: src.position.x + src.size.w + SPLIT_GAP_PX, y: src.position.y },
        size: { ...src.size },
        sourceSize: { ...src.sourceSize },
      };
      // Migrate only edges that target the source AND are scoped to the peeled layer.
      for (const edge of Object.values(state.tetherEdges)) {
        if (edge.targetImageNodeId !== sourceId) continue;
        if (edge.scope.kind !== 'layer') continue;
        if (edge.scope.layerId !== layerIdToSplit) continue;
        edge.targetImageNodeId = newId;
      }
    });
    return newId;
  },

  mergeImageNodes: (sourceId, targetId) => {
    set((state) => {
      const src = state.imageNodes[sourceId];
      const tgt = state.imageNodes[targetId];
      if (!src || !tgt || sourceId === targetId) return;
      // Append source layers to target (target keeps its id).
      tgt.layerIds.push(...src.layerIds);
      // Redirect every edge pointing at the source to the target (scope preserved).
      for (const edge of Object.values(state.tetherEdges)) {
        if (edge.targetImageNodeId === sourceId) edge.targetImageNodeId = targetId;
      }
      delete state.imageNodes[sourceId];
      // Stale active/previous mirrors must not survive a node deletion.
      if (state.activeImageNodeId === sourceId) state.activeImageNodeId = targetId;
      if (state.previousImageNodeId === sourceId) state.previousImageNodeId = null;
    });
  },

  removeImageNode: (id) =>
    set((state) => {
      if (!state.imageNodes[id]) return;
      delete state.imageNodes[id];
      // Cascade: remove tether edges pointing at this node.
      for (const edgeId of Object.keys(state.tetherEdges)) {
        if (state.tetherEdges[edgeId].targetImageNodeId === id) {
          delete state.tetherEdges[edgeId];
        }
      }
      // Clear active mirror if it was this node.
      if (state.activeImageNodeId === id) {
        state.activeImageNodeId = null;
      }
      // Clear previous-mirror too — a deleted node is no longer a valid merge target.
      if (state.previousImageNodeId === id) {
        state.previousImageNodeId = null;
      }
      delete state.imageNodeMode[id];
    }),

  resyncNodeSeq: () =>
    set((state) => {
      // `in-<n>` (image nodes) and `info-<n>` (info nodes) share this counter.
      let maxSeq = 0;
      const scan = (ids: string[]) => {
        for (const id of ids) {
          const m = /-(\d+)$/.exec(id);
          if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
        }
      };
      scan(Object.keys(state.imageNodes));
      scan(Object.keys(state.infoNodes));
      state._nextNodeSeq = Math.max(state._nextNodeSeq, maxSeq + 1);
    }),

  setNodePosition: (id, position) =>
    set((state) => {
      const n = state.imageNodes[id];
      if (n) n.position = position;
    }),

  setWidgetPosition: (id, position) =>
    set((state) => {
      const existing = state.widgetNodes[id];
      if (existing) {
        existing.position = position;
      } else {
        state.widgetNodes[id] = { id, position };
      }
    }),

  setWidgetSize: (id, size) =>
    set((state) => {
      const existing = state.widgetNodes[id];
      if (existing) existing.size = { ...size };
    }),

  setEdge: (edge) =>
    set((state) => {
      state.tetherEdges[edge.id] = { ...edge };
    }),

  unbindEdge: (edgeId) =>
    set((state) => {
      delete state.tetherEdges[edgeId];
    }),

  setActiveImageNode: (activeImageNodeId) =>
    set((state) => {
      // Track previous: when the active id changes to a different non-null
      // value, the old value (if present and distinct) becomes "previous".
      // Selecting the same node again is a no-op for `previous`; clearing to
      // null preserves the previous so it remains a valid merge target.
      if (
        activeImageNodeId !== null &&
        state.activeImageNodeId !== null &&
        state.activeImageNodeId !== activeImageNodeId
      ) {
        state.previousImageNodeId = state.activeImageNodeId;
      }
      state.activeImageNodeId = activeImageNodeId;
    }),

  setWorkspaceViewport: (v) =>
    set((state) => {
      state.workspaceViewport = v;
    }),

  setImageNodeMode: (id, mode) =>
    set((state) => {
      state.imageNodeMode[id] = mode;
    }),

  // ─── Info widgets ─────────────────────────────────────────────────
  addInfoNode: (content, options) => {
    let id = '';
    set((state) => {
      id = `info-${state._nextNodeSeq++}`;
      state.infoNodes[id] = {
        id,
        position: options?.position ?? { x: 200, y: 200 },
        // Default size hint depends on the kind — stats/cast cards stay
        // narrow; histogram + palette want a wider strip.
        size: options?.size ?? defaultSizeFor(content.kind),
        title: options?.title,
        // Structured-clone-equivalent: spread the payload so the store
        // never aliases the caller's references.
        content: cloneContent(content),
        targetImageNodeId: options?.targetImageNodeId,
      };
    });
    return id;
  },
  setInfoNodePosition: (id, position) =>
    set((state) => {
      const n = state.infoNodes[id];
      if (!n) return;
      n.position = position;
    }),
  updateInfoNode: (id, patch) =>
    set((state) => {
      const n = state.infoNodes[id];
      if (!n) return;
      if (patch.content !== undefined) n.content = cloneContent(patch.content);
      if (patch.title !== undefined) n.title = patch.title;
      if (patch.size !== undefined) n.size = patch.size;
    }),
  removeInfoNode: (id) =>
    set((state) => {
      delete state.infoNodes[id];
    }),

  resetWorkspace: () =>
    set((state) => {
      state.imageNodes = {};
      state.widgetNodes = {};
      state.tetherEdges = {};
      state.infoNodes = {};
      state.workspaceViewport = { zoom: 1, pan: { x: 0, y: 0 } };
      state.activeImageNodeId = null;
      state.previousImageNodeId = null;
      state.imageNodeMode = {};
      state._nextNodeSeq = 1;
      state._nextEdgeSeq = 1;
    }),
});
