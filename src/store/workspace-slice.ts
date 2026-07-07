import type { StateCreator } from 'zustand';
import type {
  ImageNodeState,
  InfoNodeContent,
  InfoNodeState,
  LayerNodeState,
  Point,
  Size,
  TetherEdgeState,
  WidgetNodeState,
  WorkspaceViewport,
} from '@/types/workspace';
import type { Widget } from '@/types/widget';
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

/** Approximate canvas width of the layers node, used only to seed its initial
 *  position to the LEFT of the image node. Once measured / dragged, the real
 *  size + user position take over. */
const LAYER_NODE_WIDTH = 150;
/** Gap between the layers node's right edge and the image node's left edge. */
const LAYER_NODE_GAP = 28;

/** Deterministic layers-node id for an image node (1:1). */
export function layerNodeIdFor(imageNodeId: string): string {
  return `layers-${imageNodeId}`;
}

/** Seed position: park the layers node just left of its image node, top-aligned. */
function defaultLayerNodePosition(image: Pick<ImageNodeState, 'position'>): Point {
  return {
    x: image.position.x - LAYER_NODE_WIDTH - LAYER_NODE_GAP,
    y: image.position.y,
  };
}

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
  /** Standalone layers nodes — one per image node, keyed by `layers-<imageNodeId>`.
   *  Created/removed by the image-node lifecycle ops below. */
  layerNodes: Record<string, LayerNodeState>;
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

  /** Image node currently highlighted as a rejoin drop-target — set while an
   *  extracted node is dragged over its source so the source can pulse a
   *  "release to rejoin" cue. UI-only, transient (cleared on drag end). */
  rejoinTargetNodeId: string | null;

  /** Per-ImageNode UI-only display mode. Absent ⇒ caller's default
   *  (typically 'objects' when candidateRegions exist, else 'layers').
   *  UI-only; not part of the snapshot SSoT. */
  imageNodeMode: Record<string, 'layers' | 'objects'>;
  /** Per extracted-node "mirror preview" flag: when true, the child's edited
   *  pixels are drawn back onto its source image at the object's original
   *  spot, so you can preview the extraction in place before rejoining.
   *  Keyed by the EXTRACTED node id. UI-only. */
  mirrorPreview: Record<string, boolean>;
  toggleMirrorPreview: (extractedNodeId: string) => void;

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
  /** Move a layers node to a new canvas position (drag-stop persists here). */
  setLayerNodePosition: (id: string, position: Point) => void;
  /** Persist a layers node's React-Flow-measured size so its tether edges route
   *  to the real extent. No-op if the node doesn't exist. */
  setLayerNodeSize: (id: string, size: Size) => void;
  /** Ensure a layers node exists for `imageNodeId` (idempotent). Used to
   *  back-fill nodes for sessions restored before layers nodes existed and for
   *  any path that sets `imageNodes` directly (rehydrate). */
  ensureLayerNode: (imageNodeId: string) => void;
  /** Creates the entry if it does not yet exist. */
  setWidgetPosition: (id: string, position: Point) => void;
  /** Persist the widget's React-Flow-measured canvas size. No-op if the widget
   *  node doesn't exist yet (only positioned widgets need a collision footprint). */
  setWidgetSize: (id: string, size: Size) => void;
  /** Set the widget's user uniform scale (bottom-right corner resize). Creates
   *  the entry if it doesn't exist yet. */
  setWidgetScale: (id: string, scale: number) => void;
  /**
   * Insert or replace an edge by `edge.id`. The caller owns the id.
   */
  setEdge: (edge: TetherEdgeState) => void;
  unbindEdge: (edgeId: string) => void;
  /** Optimistically add a (widget → layer) tether target. Instant canvas
   *  feedback; the backend `update_widget_targets` call + `syncWidgetTethers`
   *  reconcile against the snapshot. Idempotent per (widget, layer). */
  addWidgetTarget: (widgetId: string, imageNodeId: string, layerId: string) => void;
  /** Move a tether's target end to a different layer/photo (reconnect). */
  retargetWidget: (edgeId: string, imageNodeId: string, layerId: string) => void;
  /** Remove a single tether target — one edge, other targets untouched. */
  removeWidgetTarget: (edgeId: string) => void;
  /** Rebuild all widget tethers from the snapshot's active widgets. Reconciles
   *  the optimistic tetherEdges mirror against the backend source of truth
   *  (widget.nodes[0].layerIds ?? [layerId]). Resolves each layer to its
   *  owning image node; drops targets that don't resolve. */
  syncWidgetTethers: (widgets: Widget[]) => void;
  /**
   * Mirror the currently active image node id derived from selection-slice.
   * The workspace slice does not own selection state.
   */
  setActiveImageNode: (activeImageNodeId: string | null) => void;
  setRejoinTargetNodeId: (id: string | null) => void;
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
  layerNodes: {},
  workspaceViewport: { zoom: 1, pan: { x: 0, y: 0 } },
  activeImageNodeId: null,
  previousImageNodeId: null,
  rejoinTargetNodeId: null,
  imageNodeMode: {},
  mirrorPreview: {},
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
      // Spawn the paired layers node just left of the image node.
      const lnId = layerNodeIdFor(id);
      state.layerNodes[lnId] = {
        id: lnId,
        imageNodeId: id,
        position: defaultLayerNodePosition(state.imageNodes[id]),
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
      // The peeled node gets its own layers node.
      const newLnId = layerNodeIdFor(newId);
      state.layerNodes[newLnId] = {
        id: newLnId,
        imageNodeId: newId,
        position: defaultLayerNodePosition(state.imageNodes[newId]),
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
      // The merged-away node's layers node goes with it (target keeps its own,
      // which now reflects the appended layerIds).
      delete state.layerNodes[layerNodeIdFor(sourceId)];
      // Stale active/previous mirrors must not survive a node deletion.
      if (state.activeImageNodeId === sourceId) state.activeImageNodeId = targetId;
      if (state.previousImageNodeId === sourceId) state.previousImageNodeId = null;
    });
  },

  removeImageNode: (id) =>
    set((state) => {
      if (!state.imageNodes[id]) return;
      delete state.imageNodes[id];
      // Cascade: drop the paired layers node.
      delete state.layerNodes[layerNodeIdFor(id)];
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
      delete state.mirrorPreview[id];
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

  setLayerNodePosition: (id, position) =>
    set((state) => {
      const n = state.layerNodes[id];
      if (n) n.position = position;
    }),

  setLayerNodeSize: (id, size) =>
    set((state) => {
      const n = state.layerNodes[id];
      if (n) n.size = { ...size };
    }),

  ensureLayerNode: (imageNodeId) =>
    set((state) => {
      const image = state.imageNodes[imageNodeId];
      if (!image) return;
      const lnId = layerNodeIdFor(imageNodeId);
      if (state.layerNodes[lnId]) return;
      state.layerNodes[lnId] = {
        id: lnId,
        imageNodeId,
        position: defaultLayerNodePosition(image),
      };
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

  setWidgetScale: (id, scale) =>
    set((state) => {
      const existing = state.widgetNodes[id];
      if (existing) existing.scale = scale;
      else state.widgetNodes[id] = { id, position: { x: 0, y: 0 }, scale };
    }),

  setEdge: (edge) =>
    set((state) => {
      state.tetherEdges[edge.id] = { ...edge };
    }),

  unbindEdge: (edgeId) =>
    set((state) => {
      delete state.tetherEdges[edgeId];
    }),

  addWidgetTarget: (widgetId, imageNodeId, layerId) =>
    set((state) => {
      const id = `te-${widgetId}-${layerId}`;
      if (state.tetherEdges[id]) return; // idempotent per (widget, layer)
      state.tetherEdges[id] = {
        id,
        widgetNodeId: widgetId,
        targetImageNodeId: imageNodeId,
        layerId,
        scope: { kind: 'layer', layerId },
      };
    }),

  retargetWidget: (edgeId, imageNodeId, layerId) =>
    set((state) => {
      const prev = state.tetherEdges[edgeId];
      if (!prev) return;
      delete state.tetherEdges[edgeId];
      const id = `te-${prev.widgetNodeId}-${layerId}`;
      state.tetherEdges[id] = {
        id,
        widgetNodeId: prev.widgetNodeId,
        targetImageNodeId: imageNodeId,
        layerId,
        scope: { kind: 'layer', layerId },
      };
    }),

  removeWidgetTarget: (edgeId) =>
    set((state) => {
      delete state.tetherEdges[edgeId];
    }),

  syncWidgetTethers: (widgets) =>
    set((state) => {
      const next: Record<string, TetherEdgeState> = {};
      for (const w of widgets) {
        if (w.status !== 'active') continue;
        // Genfill widgets have NO op-graph nodes; their target image node is on
        // `genfill.imageNodeId`. Emit a tether to that node's first layer here
        // too, otherwise this full-rebuild would wipe the edge seeded at spawn
        // on the next snapshot reconcile.
        if (w.genfill) {
          const inId = w.genfill.imageNodeId;
          const layerId = state.imageNodes[inId]?.layerIds[0];
          if (layerId) {
            const id = `te-${w.id}-${layerId}`;
            next[id] = {
              id,
              widgetNodeId: w.id,
              targetImageNodeId: inId,
              layerId,
              scope: { kind: 'layer', layerId },
            };
          }
          continue;
        }
        const node = w.nodes[0];
        if (!node) continue;
        const layerIds =
          node.layerIds ?? (node.layerId ? [node.layerId] : []);
        for (const layerId of layerIds) {
          let targetImageNodeId: string | null = null;
          for (const n of Object.values(state.imageNodes)) {
            if (n.layerIds.includes(layerId)) { targetImageNodeId = n.id; break; }
          }
          if (!targetImageNodeId) continue;
          const id = `te-${w.id}-${layerId}`;
          next[id] = {
            id,
            widgetNodeId: w.id,
            targetImageNodeId,
            layerId,
            scope: { kind: 'layer', layerId },
          };
        }
      }
      state.tetherEdges = next;
    }),

  setRejoinTargetNodeId: (id) =>
    set((state) => {
      state.rejoinTargetNodeId = id;
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

  toggleMirrorPreview: (extractedNodeId) =>
    set((state) => {
      state.mirrorPreview[extractedNodeId] = !state.mirrorPreview[extractedNodeId];
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
      state.layerNodes = {};
      state.workspaceViewport = { zoom: 1, pan: { x: 0, y: 0 } };
      state.activeImageNodeId = null;
      state.previousImageNodeId = null;
      state.rejoinTargetNodeId = null;
      state.imageNodeMode = {};
      state.mirrorPreview = {};
      state._nextNodeSeq = 1;
      state._nextEdgeSeq = 1;
    }),
});
