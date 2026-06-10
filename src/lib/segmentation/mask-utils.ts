import type { RegionPolygon } from '@/types/image-context';

/** Standard ray-casting point-in-polygon. Point and polygon in any
 *  coordinate space (caller's convention). */
export function pointInPolygon(point: [number, number], poly: RegionPolygon): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface PolygonRegion {
  id: string;
  paths: RegionPolygon[];
}

/** Returns ids of regions whose ANY polygon contains the point. */
export function polygonsAtPoint(
  point: [number, number],
  regions: PolygonRegion[],
): string[] {
  const hits: string[] = [];
  for (const region of regions) {
    for (const poly of region.paths) {
      if (pointInPolygon(point, poly)) {
        hits.push(region.id);
        break;
      }
    }
  }
  return hits;
}

/** Normalised-coord bbox enclosing every path. Returns [x, y, w, h]. */
export function bboxOfPaths(paths: RegionPolygon[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of paths) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX - minX, maxY - minY];
}
