import type { StateCreator } from 'zustand';
import type {
  ImageNodeState,
  TetherEdgeState,
  WidgetNodeState,
  WorkspaceViewport,
} from '@/types/workspace';

const DEFAULT_NODE_SIZE = { w: 240, h: 180 };

export interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetNodes: Map<string, WidgetNodeState>;
  tetherEdges: Record<string, TetherEdgeState>;
  viewport: WorkspaceViewport;
  workspaceExpandedWidgetIds: Set<string>;
  activeImageNodeId: string | null;

  addImageNode: (layerIds: string[], position?: { x: number; y: number }) => string;
  /**
   * Peel a single layer off `sourceId`, place it on a new image node, and return the new node's id.
   * Source node survives (minus the migrated layer). Tether edges whose
   * `targetImageNodeId === sourceId` AND whose scope is `{ kind: 'layer', layerId: layerIdToSplit }`
   * are redirected to the new node id. All other edges remain on the source.
   */
  splitImageNode: (sourceId: string, layerIdToSplit: string) => string;
  /**
   * Append source's layerIds to target's, delete the source node, and redirect every tether edge
   * whose `targetImageNodeId === sourceId` to `targetId` (scope preserved). Target keeps its id.
   */
  mergeImageNodes: (sourceId: string, targetId: string) => void;
  setNodePosition: (id: string, position: { x: number; y: number }) => void;
  setWidgetPosition: (id: string, position: { x: number; y: number }) => void;
  /**
   * Insert or replace an edge by `edge.id`. The caller owns the id; use `newEdgeId()` to allocate.
   */
  setEdge: (edge: TetherEdgeState) => void;
  unbindEdge: (edgeId: string) => void;
  /**
   * Mirror the currently active image node id derived from selection-slice.
   * The workspace slice does not own selection state.
   */
  setSelection: (activeImageNodeId: string | null) => void;
  setViewport: (v: WorkspaceViewport) => void;
  toggleWorkspaceExpanded: (widgetId: string) => void;
  resetWorkspace: () => void;
}

let nextNodeCounter = 1;
function newNodeId() { return `in-${nextNodeCounter++}`; }
let nextEdgeCounter = 1;
export function newEdgeId() { return `te-${nextEdgeCounter++}`; }

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [['zustand/immer', never]], []> = (set) => ({
  imageNodes: {},
  widgetNodes: new Map(),
  tetherEdges: {},
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  workspaceExpandedWidgetIds: new Set<string>(),
  activeImageNodeId: null,

  addImageNode: (layerIds, position = { x: 0, y: 0 }) => {
    const id = newNodeId();
    set((s) => {
      s.imageNodes[id] = { id, layerIds: [...layerIds], position, size: { ...DEFAULT_NODE_SIZE } };
    });
    return id;
  },

  splitImageNode: (sourceId, layerIdToSplit) => {
    const newId = newNodeId();
    set((s) => {
      const src = s.imageNodes[sourceId];
      if (!src) return;
      if (!src.layerIds.includes(layerIdToSplit)) return;
      // Remove the layer from the source.
      src.layerIds = src.layerIds.filter((lid) => lid !== layerIdToSplit);
      // Place the peeled layer on a new node positioned next to the source.
      s.imageNodes[newId] = {
        id: newId,
        layerIds: [layerIdToSplit],
        position: { x: src.position.x + DEFAULT_NODE_SIZE.w + 24, y: src.position.y },
        size: { ...DEFAULT_NODE_SIZE },
      };
      // Migrate only edges that target the source AND are scoped to the peeled layer.
      for (const edge of Object.values(s.tetherEdges)) {
        if (edge.targetImageNodeId !== sourceId) continue;
        if (edge.scope.kind !== 'layer') continue;
        if (edge.scope.layerId !== layerIdToSplit) continue;
        edge.targetImageNodeId = newId;
      }
    });
    return newId;
  },

  mergeImageNodes: (sourceId, targetId) => {
    set((s) => {
      const src = s.imageNodes[sourceId];
      const tgt = s.imageNodes[targetId];
      if (!src || !tgt || sourceId === targetId) return;
      // Append source layers to target (target keeps its id).
      tgt.layerIds.push(...src.layerIds);
      // Redirect every edge pointing at the source to the target (scope preserved).
      for (const edge of Object.values(s.tetherEdges)) {
        if (edge.targetImageNodeId === sourceId) edge.targetImageNodeId = targetId;
      }
      delete s.imageNodes[sourceId];
    });
  },

  setNodePosition: (id, position) =>
    set((s) => {
      const n = s.imageNodes[id];
      if (n) n.position = position;
    }),

  setWidgetPosition: (id, position) =>
    set((s) => {
      const existing = s.widgetNodes.get(id);
      if (existing) {
        existing.position = position;
      } else {
        s.widgetNodes.set(id, { id, position });
      }
    }),

  setEdge: (edge) =>
    set((s) => {
      s.tetherEdges[edge.id] = { ...edge };
    }),

  unbindEdge: (edgeId) =>
    set((s) => {
      delete s.tetherEdges[edgeId];
    }),

  setSelection: (activeImageNodeId) =>
    set((s) => {
      s.activeImageNodeId = activeImageNodeId;
    }),

  setViewport: (v) =>
    set((s) => {
      s.viewport = v;
    }),

  toggleWorkspaceExpanded: (widgetId) =>
    set((s) => {
      if (s.workspaceExpandedWidgetIds.has(widgetId)) s.workspaceExpandedWidgetIds.delete(widgetId);
      else s.workspaceExpandedWidgetIds.add(widgetId);
    }),

  resetWorkspace: () =>
    set((s) => {
      s.imageNodes = {};
      s.widgetNodes.clear();
      s.tetherEdges = {};
      s.viewport = { zoom: 1, pan: { x: 0, y: 0 } };
      s.workspaceExpandedWidgetIds.clear();
      s.activeImageNodeId = null;
      nextNodeCounter = 1;
      nextEdgeCounter = 1;
    }),
});
