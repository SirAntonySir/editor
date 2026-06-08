import type { Size } from '@/types/workspace';

export const SPAWN_GAP = 24;
const WIDGET_OFFSET_Y = 45; // visual centre of an empty widget header
/**
 * Maximum horizontal anchor offset used when computing a spawn position.
 * Image nodes can be source-size wide (multiple thousand pixels), which would
 * push widgets far past the visible viewport. Capping the offset keeps widgets
 * within the user's view at fit-zoom regardless of source-image dimensions.
 */
export const MAX_TARGET_SPAWN_OFFSET = 400;

export interface PlacedRect {
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export interface Viewport {
  pan: { x: number; y: number };
  zoom: number;
  screen: { w: number; h: number };
}

/** Pick which side of `target` to spawn the next widget on, based on where
 *  the image sits in the viewport. The side with MORE empty viewport space
 *  wins. Ties default to LEFT.
 *
 *  All math is in canvas coordinates. React Flow maps canvas (cx, cy) →
 *  screen (cx*zoom + pan.x, cy*zoom + pan.y); inverting: canvas_x =
 *  (screen_x - pan.x) / zoom. */
export function pickSpawnSide(target: PlacedRect, viewport: Viewport): 'left' | 'right' {
  const viewportCenterCanvasX = (viewport.screen.w / 2 - viewport.pan.x) / viewport.zoom;
  const imageCenterCanvasX = target.position.x + target.size.w / 2;

  // Tie band: ±5% of viewport width (in canvas units after dividing by zoom).
  const tieBand = (viewport.screen.w * 0.05) / viewport.zoom;
  if (Math.abs(imageCenterCanvasX - viewportCenterCanvasX) <= tieBand) return 'left';

  // Image RIGHT of viewport center → empty space LEFT → spawn LEFT.
  return imageCenterCanvasX > viewportCenterCanvasX ? 'left' : 'right';
}

export function nextSpawnPositionFor(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
  side: 'left' | 'right' = 'right',
): { x: number; y: number } {
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const x = side === 'right'
    ? target.position.x + xOffset + SPAWN_GAP
    : target.position.x - ownSize.w - SPAWN_GAP;
  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: ownSize }, o))) {
    y += ownSize.h + SPAWN_GAP;
  }
  return { x, y };
}

function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  return (
    a.position.x < b.position.x + b.size.w &&
    b.position.x < a.position.x + a.size.w &&
    a.position.y < b.position.y + b.size.h &&
    b.position.y < a.position.y + a.size.h
  );
}
