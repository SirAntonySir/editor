import type { PlacedRect } from './workspace-layout';

export function bboxOf(rects: PlacedRect[]): { x: number; y: number; w: number; h: number } | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.position.x));
  const minY = Math.min(...rects.map((r) => r.position.y));
  const maxX = Math.max(...rects.map((r) => r.position.x + r.size.w));
  const maxY = Math.max(...rects.map((r) => r.position.y + r.size.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
