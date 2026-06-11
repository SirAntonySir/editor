import type { RegionPolygon } from '@/types/image-context';

interface SegmentOverlayProps {
  widthPx: number;
  heightPx: number;
  hoveredPolygons: RegionPolygon[];
  selectedPolygons: RegionPolygon[];
}

function pathFromPolygon(p: RegionPolygon, w: number, h: number): string {
  if (p.length === 0) return '';
  return p
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x * w} ${y * h}`)
    .join(' ') + ' Z';
}

export function SegmentOverlay({
  widthPx, heightPx, hoveredPolygons, selectedPolygons,
}: SegmentOverlayProps) {
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={widthPx}
      height={heightPx}
      aria-hidden
    >
      {hoveredPolygons.map((poly, i) => (
        <path
          key={`h-${i}`}
          d={pathFromPolygon(poly, widthPx, heightPx)}
          // Light translucent fill on hover so the region is visible as a
          // shape, not just an outline. Stroke stays dashed to differentiate
          // from a committed selection.
          fill="var(--accent-hover)"
          fillOpacity={0.12}
          stroke="var(--accent-hover)"
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.95}
        />
      ))}
      {selectedPolygons.map((poly, i) => (
        <path
          key={`s-${i}`}
          d={pathFromPolygon(poly, widthPx, heightPx)}
          // Stronger fill on selected — the committed selection should read
          // as a filled tint, not just an outline.
          fill="var(--accent-selected)"
          fillOpacity={0.22}
          stroke="var(--accent-selected)"
          strokeWidth={1.5}
          opacity={1}
        />
      ))}
    </svg>
  );
}
