export const SPAWN_GAP = 24;
const WIDGET_OFFSET_Y = 45; // visual centre of an empty widget header

export interface PlacedRect {
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export function nextSpawnPositionFor(
  target: PlacedRect,
  kind: 'widget' | 'image',
  occupied: PlacedRect[],
): { x: number; y: number } {
  const x = target.position.x + target.size.w + SPAWN_GAP;
  let y = kind === 'widget' ? target.position.y + WIDGET_OFFSET_Y : target.position.y;
  while (occupied.some((o) => rectsOverlap({ position: { x, y }, size: target.size }, o))) {
    y += target.size.h + SPAWN_GAP;
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
