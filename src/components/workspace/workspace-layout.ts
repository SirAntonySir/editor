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

export function nextSpawnPositionFor(
  target: PlacedRect,
  ownSize: Size,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
): { x: number; y: number } {
  const xOffset = Math.min(target.size.w, MAX_TARGET_SPAWN_OFFSET);
  const x = target.position.x + xOffset + SPAWN_GAP;
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
