export type NodeScopeKind = 'layer' | 'node' | 'unbound';

export interface ImageNodeState {
  id: string;
  layerIds: string[];
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export interface WidgetNodeState {
  id: string;
  position: { x: number; y: number };
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
  pan: { x: number; y: number };
}
