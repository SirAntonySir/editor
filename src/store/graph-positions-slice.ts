import type { StateCreator } from 'zustand';
import type { NodePosition } from '@/types/graph';

export interface GraphPositionsSlice {
  graphPositions: Record<string, NodePosition>;
  selectedNodeId: string | null;

  updateNodePosition: (stableKey: string, pos: NodePosition) => void;
  updateNodePositions: (batch: Record<string, NodePosition>) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setGraphPositions: (positions: Record<string, NodePosition>) => void;
}

export const createGraphPositionsSlice: StateCreator<
  GraphPositionsSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  graphPositions: {},
  selectedNodeId: null,

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

  setGraphPositions: (positions) =>
    set((state) => {
      state.graphPositions = positions;
    }),
});
