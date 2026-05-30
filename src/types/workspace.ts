export type Point = { x: number; y: number };
export type Size = { w: number; h: number };

export interface ImageNodeState {
  id: string;
  layerIds: string[];
  position: Point;
  size: Size;
}

export interface WidgetNodeState {
  id: string;
  position: Point;
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
  pan: Point;
}
