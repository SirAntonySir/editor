import { ImageNodeDrafting } from './drafting/ImageNodeDrafting';

export interface ImageNodeData extends Record<string, unknown> {
  name?: string;
  layerIds: string[];
  /** Canvas-space layout box (display dims). Drives outer wrapper sizing,
   *  React Flow's layout, and CSS dims of the visible canvas. */
  size: { w: number; h: number };
  /** Source bitmap dimensions in pixels. Drives the WebGL pipeline + crop
   *  geometry. Independent of `size` so a 6000×4000 photo and a 300×200
   *  thumbnail render at the same canvas-space box. */
  sourceSize: { w: number; h: number };
  activeLayerIndex?: number;
}

interface ImageNodeProps {
  id: string;
  data: ImageNodeData;
  selected: boolean;
}

/**
 * Stable export for React Flow's `nodeTypes` registration.
 * `ImageNodeDrafting` is the sole visual implementation;
 * the Classic branch was removed in Task 3.1.
 */
export function ImageNode(props: ImageNodeProps) {
  return <ImageNodeDrafting {...props} />;
}
