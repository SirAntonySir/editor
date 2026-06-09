import type { StateCreator } from 'zustand';
import type {
  ImageNodeState,
  Point,
  Size,
  TetherEdgeState,
  WidgetNodeState,
  WorkspaceViewport,
} from '@/types/workspace';

/** Default source dims when the caller doesn't pass any (e.g. unit tests). */
const DEFAULT_SOURCE_SIZE: Size = { w: 240, h: 180 };

/**
 * Canvas-space width for a newly-created image node. Independent of source
 * pixel dims so every image enters the workspace at the same visual size.
 * Height is derived from this width × source aspect ratio.
 */
const DEFAULT_IMAGE_NODE_DISPLAY_WIDTH = 600;

/** Lower / upper bounds for interactive resize. Aspect-locked, so only the
 *  width axis is bounded here; height follows. */
export const IMAGE_NODE_MIN_DISPLAY_WIDTH = 120;
export const IMAGE_NODE_MAX_DISPLAY_WIDTH = 4000;

const SPLIT_GAP_PX = 24;

function deriveDisplaySize(sourceSize: Size, displayWidth: number): Size {
  const aspect = sourceSize.h > 0 ? sourceSize.w / sourceSize.h : 1;
  return { w: displayWidth, h: displayWidth / aspect };
}

export interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetNodes: Record<string, WidgetNodeState>;
  tetherEdges: Record<string, TetherEdgeState>;
  workspaceViewport: WorkspaceViewport;
  activeImageNodeId: string | null;

  /** Private id sequences. Reset by `resetWorkspace`. */
  _nextNodeSeq: number;
  _nextEdgeSeq: number;

  /**
   * Create an image node.
   * @param sourceSize  source bitmap dimensions in pixels. Used by the WebGL
   *                    pipeline and to derive the initial display height.
   *                    Defaults to a placeholder if omitted (test fixtures).
   */
  addImageNode: (layerIds: string[], position?: Point, sourceSize?: Size) => string;
  /**
   * Resize an image node's canvas-space box. Aspect-locked to its source dims:
   * caller specifies the new width; height is recomputed. Clamped to
   * [IMAGE_NODE_MIN_DISPLAY_WIDTH, IMAGE_NODE_MAX_DISPLAY_WIDTH].
   */
  setImageNodeDisplayWidth: (id: string, width: number) => void;
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
  setNodePosition: (id: string, position: Point) => void;
  /** Creates the entry if it does not yet exist. */
  setWidgetPosition: (id: string, position: Point) => void;
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
  setWorkspaceViewport: (v: WorkspaceViewport) => void;
  resetWorkspace: () => void;
}

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [['zustand/immer', never]], []> = (set) => ({
  imageNodes: {},
  widgetNodes: {},
  tetherEdges: {},
  workspaceViewport: { zoom: 1, pan: { x: 0, y: 0 } },
  activeImageNodeId: null,
  _nextNodeSeq: 1,
  _nextEdgeSeq: 1,

  addImageNode: (layerIds, position = { x: 0, y: 0 }, sourceSize) => {
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
      state.activeImageNodeId = activeImageNodeId;
    }),

  setWorkspaceViewport: (v) =>
    set((state) => {
      state.workspaceViewport = v;
    }),

  resetWorkspace: () =>
    set((state) => {
      state.imageNodes = {};
      state.widgetNodes = {};
      state.tetherEdges = {};
      state.workspaceViewport = { zoom: 1, pan: { x: 0, y: 0 } };
      state.activeImageNodeId = null;
      state._nextNodeSeq = 1;
      state._nextEdgeSeq = 1;
    }),
});
