import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { NodePosition } from '@/types/graph';

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphStore {
  graphPositions: Record<string, NodePosition>;
  selectedNodeId: string | null;
  highlightedNodeId: string | null;
  graphViewport: GraphViewport;
  graphLayoutKey: string;
  showGraphPreview: boolean;

  updateNodePosition: (stableKey: string, pos: NodePosition) => void;
  updateNodePositions: (batch: Record<string, NodePosition>) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setHighlightedNode: (nodeId: string | null) => void;
  setGraphPositions: (positions: Record<string, NodePosition>) => void;
  setGraphViewport: (viewport: GraphViewport) => void;
  setGraphLayoutKey: (key: string) => void;
  toggleGraphPreview: () => void;
  pruneGraphPositions: (validKeys: Set<string>) => void;
}

export const useGraphStore = create<GraphStore>()(
  devtools(
    immer((set) => ({
      graphPositions: {},
      selectedNodeId: null,
      highlightedNodeId: null,
      graphViewport: { x: 0, y: 0, zoom: 0 },
      graphLayoutKey: '',
      showGraphPreview: true,

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

      toggleGraphPreview: () =>
        set((state) => {
          state.showGraphPreview = !state.showGraphPreview;
        }),

      pruneGraphPositions: (validKeys) =>
        set((state) => {
          for (const key of Object.keys(state.graphPositions)) {
            if (!validKeys.has(key)) {
              delete state.graphPositions[key];
            }
          }
        }),
    })),
    { name: 'graph-store' },
  ),
);
