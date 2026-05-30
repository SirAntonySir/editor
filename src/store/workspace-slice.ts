import type { StateCreator } from 'zustand';
import type {
  ImageNodeState,
  Point,
  Size,
  TetherEdgeState,
  WidgetNodeState,
  WorkspaceViewport,
} from '@/types/workspace';

const DEFAULT_NODE_SIZE: Size = { w: 240, h: 180 };
const SPLIT_GAP_PX = 24;

export interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetNodes: Record<string, WidgetNodeState>;
  tetherEdges: Record<string, TetherEdgeState>;
  workspaceViewport: WorkspaceViewport;
  workspaceExpandedWidgetIds: Set<string>;
  activeImageNodeId: string | null;

  /** Private id sequences. Reset by `resetWorkspace`. */
  _nextNodeSeq: number;
  _nextEdgeSeq: number;

  addImageNode: (layerIds: string[], position?: Point) => string;
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
  toggleWorkspaceExpanded: (widgetId: string) => void;
  resetWorkspace: () => void;
}

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [['zustand/immer', never]], []> = (set) => ({
  imageNodes: {},
  widgetNodes: {},
  tetherEdges: {},
  workspaceViewport: { zoom: 1, pan: { x: 0, y: 0 } },
  workspaceExpandedWidgetIds: new Set<string>(),
  activeImageNodeId: null,
  _nextNodeSeq: 1,
  _nextEdgeSeq: 1,

  addImageNode: (layerIds, position = { x: 0, y: 0 }) => {
    let id = '';
    set((state) => {
      id = `in-${state._nextNodeSeq++}`;
      state.imageNodes[id] = { id, layerIds: [...layerIds], position, size: { ...DEFAULT_NODE_SIZE } };
    });
    return id;
  },

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
      state.imageNodes[newId] = {
        id: newId,
        layerIds: [layerIdToSplit],
        position: { x: src.position.x + DEFAULT_NODE_SIZE.w + SPLIT_GAP_PX, y: src.position.y },
        size: { ...DEFAULT_NODE_SIZE },
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

  toggleWorkspaceExpanded: (widgetId) =>
    set((state) => {
      if (state.workspaceExpandedWidgetIds.has(widgetId)) state.workspaceExpandedWidgetIds.delete(widgetId);
      else state.workspaceExpandedWidgetIds.add(widgetId);
    }),

  resetWorkspace: () =>
    set((state) => {
      state.imageNodes = {};
      state.widgetNodes = {};
      state.tetherEdges = {};
      state.workspaceViewport = { zoom: 1, pan: { x: 0, y: 0 } };
      state.workspaceExpandedWidgetIds.clear();
      state.activeImageNodeId = null;
      state._nextNodeSeq = 1;
      state._nextEdgeSeq = 1;
    }),
});
