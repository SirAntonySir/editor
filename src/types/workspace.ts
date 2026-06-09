export type Point = { x: number; y: number };
export type Size = { w: number; h: number };

export interface ImageNodeState {
  id: string;
  layerIds: string[];
  position: Point;
  /**
   * Canvas-space layout box. Independent of the source bitmap dims so a 24MP
   * photo and a thumbnail render at the same workspace size. Width is the
   * resizable axis (aspect-locked to `sourceSize`); height is derived but
   * cached here so React Flow's layout / intersection math reads cleanly.
   */
  size: Size;
  /**
   * Source bitmap dimensions in pixels. Drives WebGL pipeline sizing and crop
   * coordinates; never changed by user resize.
   */
  sourceSize: Size;
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
