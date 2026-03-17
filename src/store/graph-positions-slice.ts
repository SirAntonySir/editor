import type { StateCreator } from 'zustand';
import type { NodePosition } from '@/types/graph';

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export type SplitDirection = 'horizontal' | 'vertical';

export interface GraphPositionsSlice {
  graphPositions: Record<string, NodePosition>;
  selectedNodeId: string | null;
  highlightedNodeId: string | null;
  graphViewport: GraphViewport;
  graphLayoutKey: string;
  graphSplitRatio: number;
  graphSplitDirection: SplitDirection;
  expandedNodeIds: string[];

  updateNodePosition: (stableKey: string, pos: NodePosition) => void;
  updateNodePositions: (batch: Record<string, NodePosition>) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setHighlightedNode: (nodeId: string | null) => void;
  setGraphPositions: (positions: Record<string, NodePosition>) => void;
  setGraphViewport: (viewport: GraphViewport) => void;
  setGraphLayoutKey: (key: string) => void;
  setGraphSplitRatio: (ratio: number) => void;
  setGraphSplitDirection: (dir: SplitDirection) => void;
  toggleNodeExpanded: (nodeId: string) => void;
}

export const createGraphPositionsSlice: StateCreator<
  GraphPositionsSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  graphPositions: {},
  selectedNodeId: null,
  highlightedNodeId: null,
  graphViewport: { x: 0, y: 0, zoom: 0 },
  graphLayoutKey: '',
  graphSplitRatio: 0.35,
  graphSplitDirection: 'vertical' as SplitDirection,
  expandedNodeIds: [] as string[],

  updateNodePosition: (stableKey, pos) =>
    set((state) => {
      state.graphPositions[stableKey] = pos;
    }),

  updateNodePositions: (batch) =>
    set((state) => {
      for (const [key, pos] of Object.entries(batch)) {
        state.graphPositions[key] = pos;
      }
    }),

  setSelectedNode: (nodeId) =>
    set((state) => {
      state.selectedNodeId = nodeId;
    }),

  setHighlightedNode: (nodeId) =>
    set((state) => {
      state.highlightedNodeId = nodeId;
    }),

  setGraphPositions: (positions) =>
    set((state) => {
      state.graphPositions = positions;
    }),

  setGraphViewport: (viewport) =>
    set((state) => {
      state.graphViewport = viewport;
    }),

  setGraphLayoutKey: (key) =>
    set((state) => {
      state.graphLayoutKey = key;
    }),

  setGraphSplitRatio: (ratio) =>
    set((state) => {
      state.graphSplitRatio = ratio;
    }),

  setGraphSplitDirection: (dir) =>
    set((state) => {
      state.graphSplitDirection = dir;
    }),

  toggleNodeExpanded: (nodeId) =>
    set((state) => {
      const idx = state.expandedNodeIds.indexOf(nodeId);
      if (idx >= 0) {
        state.expandedNodeIds.splice(idx, 1);
      } else {
        state.expandedNodeIds.push(nodeId);
      }
    }),
});
