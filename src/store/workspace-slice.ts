import type { StateCreator } from 'zustand';
import type { ImageNodeState, TetherEdgeState, WorkspaceViewport } from '@/types/workspace';

const DEFAULT_NODE_SIZE = { w: 240, h: 180 };

export interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetPositions: Record<string, { x: number; y: number }>;
  tetherEdges: Record<string, TetherEdgeState>;
  viewport: WorkspaceViewport;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  workspaceExpandedWidgetIds: Set<string>;
  activeImageNodeId: string | null;

  addImageNode: (layerIds: string[], position?: { x: number; y: number }) => string;
  splitImageNode: (id: string) => string[];
  mergeImageNodes: (ids: string[]) => string;
  setNodePosition: (id: string, position: { x: number; y: number }) => void;
  setWidgetPosition: (id: string, position: { x: number; y: number }) => void;
  setEdge: (widgetNodeId: string, targetImageNodeId: string, scope: TetherEdgeState['scope']) => string;
  unbindEdge: (edgeId: string) => void;
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  setViewport: (v: WorkspaceViewport) => void;
  toggleWorkspaceExpanded: (widgetId: string) => void;
  resetWorkspace: () => void;
}

let nextNodeCounter = 1;
function newNodeId() { return `in-${nextNodeCounter++}`; }
let nextEdgeCounter = 1;
function newEdgeId() { return `te-${nextEdgeCounter++}`; }

export const createWorkspaceSlice: StateCreator<WorkspaceSlice, [['zustand/immer', never]], []> = (set) => ({
  imageNodes: {},
  widgetPositions: {},
  tetherEdges: {},
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  selectedNodeIds: new Set<string>(),
  selectedEdgeIds: new Set<string>(),
  workspaceExpandedWidgetIds: new Set<string>(),
  activeImageNodeId: null,

  addImageNode: (layerIds, position = { x: 0, y: 0 }) => {
    const id = newNodeId();
    set((s) => {
      s.imageNodes[id] = { id, layerIds: [...layerIds], position, size: { ...DEFAULT_NODE_SIZE } };
    });
    return id;
  },

  splitImageNode: (id) => {
    let result: string[] = [];
    set((s) => {
      const src = s.imageNodes[id];
      if (!src) { result = []; return; }
      if (src.layerIds.length <= 1) { result = [id]; return; }
      const newIds: string[] = [];
      src.layerIds.forEach((lid, i) => {
        const nid = newNodeId();
        newIds.push(nid);
        s.imageNodes[nid] = {
          id: nid,
          layerIds: [lid],
          position: { x: src.position.x + i * (DEFAULT_NODE_SIZE.w + 24), y: src.position.y },
          size: { ...DEFAULT_NODE_SIZE },
        };
      });
      delete s.imageNodes[id];
      for (const edge of Object.values(s.tetherEdges)) {
        if (edge.targetImageNodeId !== id) continue;
        if (edge.scope.kind === 'layer') {
          const { layerId } = edge.scope;
          const owner = newIds.find((nid) => s.imageNodes[nid].layerIds.includes(layerId));
          if (owner) edge.targetImageNodeId = owner;
        } else {
          edge.targetImageNodeId = newIds[0];
        }
      }
      result = newIds;
    });
    return result;
  },

  mergeImageNodes: (ids) => {
    let newId = '';
    set((s) => {
      if (ids.length === 0) return;
      newId = newNodeId();
      const layerIds: string[] = [];
      let basePos: { x: number; y: number } | null = null;
      for (const id of ids) {
        const n = s.imageNodes[id];
        if (!n) continue;
        basePos ??= { ...n.position };
        layerIds.push(...n.layerIds);
        delete s.imageNodes[id];
      }
      s.imageNodes[newId] = {
        id: newId,
        layerIds,
        position: basePos ?? { x: 0, y: 0 },
        size: { ...DEFAULT_NODE_SIZE },
      };
      for (const edge of Object.values(s.tetherEdges)) {
        if (ids.includes(edge.targetImageNodeId)) edge.targetImageNodeId = newId;
      }
    });
    return newId;
  },

  setNodePosition: (id, position) =>
    set((s) => {
      const n = s.imageNodes[id];
      if (n) n.position = position;
    }),

  setWidgetPosition: (id, position) =>
    set((s) => {
      s.widgetPositions[id] = position;
    }),

  setEdge: (widgetNodeId, targetImageNodeId, scope) => {
    const id = newEdgeId();
    set((s) => {
      s.tetherEdges[id] = { id, widgetNodeId, targetImageNodeId, scope };
    });
    return id;
  },

  unbindEdge: (edgeId) =>
    set((s) => {
      delete s.tetherEdges[edgeId];
    }),

  setSelection: (nodeIds, edgeIds) =>
    set((s) => {
      s.selectedNodeIds = new Set(nodeIds);
      s.selectedEdgeIds = new Set(edgeIds);
      const imageOnly = nodeIds.filter((id) => s.imageNodes[id]);
      s.activeImageNodeId = imageOnly.length === 1 ? imageOnly[0] : null;
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
      s.widgetPositions = {};
      s.tetherEdges = {};
      s.viewport = { zoom: 1, pan: { x: 0, y: 0 } };
      s.selectedNodeIds.clear();
      s.selectedEdgeIds.clear();
      s.workspaceExpandedWidgetIds.clear();
      s.activeImageNodeId = null;
    }),
});
