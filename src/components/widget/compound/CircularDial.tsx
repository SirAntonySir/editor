import { useCallback, useMemo, useRef, useState } from 'react';
import type { Anchor } from '@/lib/perceptual-dial/types';
import {
  anchorAngles,
  positionToIndicatorAngle,
  angleToPosition,
  resolveWedgeColor,
  AUTO_PALETTE,
} from './wheel-math';

interface Props {
  anchors: Anchor[];                            // sorted by position[0]
  position: number;                             // 0..1
  onPositionChange: (next: number) => void;
}

const CENTER = 160;
const VIEWBOX = 320;
const WEDGE_RADIUS = 110;
const TRACK_RADIUS = 135;
const INDICATOR_RADIUS = 7;
const LABEL_RADIUS = 75;     // where label text sits

/** Convert (angleDeg from top, going clockwise) → (x, y) on a circle. */
function polar(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

/** Build an SVG path string for a pie wedge: M center L start A r,r 0 0 1 end Z */
function wedgePath(startDeg: number, endDeg: number, r: number): string {
  const [sx, sy] = polar(startDeg, r);
  const [ex, ey] = polar(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z`;
}

/** Compute SVG arc path between two angles on a ring at radius r. */
function arcPath(startDeg: number, endDeg: number, r: number): string {
  const [sx, sy] = polar(startDeg, r);
  const [ex, ey] = polar(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

/** Index of the anchor whose evenly-spaced wedge contains the given position.
 *  Used to highlight one wedge as "active" based on which segment position
 *  currently belongs to. Considers cyclic wrap at the seam. */
function activeWedgeIndex(anchors: Anchor[], position: number): number {
  if (anchors.length === 0) return -1;
  const positions = anchors.map(a => a.position[0]);
  const last = positions.length - 1;
  const t = ((position % 1) + 1) % 1;
  if (t < positions[0] || t >= positions[last]) return last;
  for (let i = 0; i < last; i++) {
    if (positions[i] <= t && t < positions[i + 1]) return i;
  }
  return last;
}

export function CircularDial({ anchors, position, onPositionChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const anchorsLike = useMemo(
    () => anchors.map((a) => {
      const ext = a as Anchor & { color?: string };
      return { position: a.position[0], name: a.label, color: ext.color };
    }),
    [anchors],
  );

  const angles = useMemo(() => anchorAngles(anchors.length), [anchors.length]);
  const wedgeSpan = 360 / Math.max(1, anchors.length);

  const indicatorAngle = useMemo(
    () => positionToIndicatorAngle(anchorsLike, position),
    [anchorsLike, position],
  );
  const [indicatorX, indicatorY] = polar(indicatorAngle, TRACK_RADIUS);

  const activeIdx = activeWedgeIndex(anchors, position);

  const handleWedgeClick = useCallback((i: number) => {
    onPositionChange(anchors[i].position[0]);
  }, [anchors, onPositionChange]);

  // Drag: convert pointer position → angle → position.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // SVG viewBox is 320x320; convert client coords to viewBox coords.
    const sx = ((e.clientX - rect.left) / rect.width) * VIEWBOX;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEWBOX;
    const dx = sx - CENTER;
    const dy = sy - CENTER;
    // atan2 returns radians where 0 = +x (right). We want 0 = top, clockwise.
    let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if (deg < 0) deg += 360;
    const next = angleToPosition(anchorsLike, deg);
    onPositionChange(next);
  }, [dragging, anchorsLike, onPositionChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // Active arc on outer ring
  const activeStart = angles[activeIdx] - wedgeSpan / 2;
  const activeEnd = angles[activeIdx] + wedgeSpan / 2;
  const activeAnchorExt = anchors[activeIdx] as Anchor & { color?: string } | undefined;
  const activeColor = resolveWedgeColor(
    { name: '', color: activeAnchorExt?.color },
    activeIdx,
    AUTO_PALETTE,
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="circular-dial"
      style={{ width: 320, height: 320, userSelect: 'none' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Wedges */}
      {anchors.map((anchor, i) => {
        const startDeg = angles[i] - wedgeSpan / 2;
        const endDeg = angles[i] + wedgeSpan / 2;
        const ext = anchor as Anchor & { color?: string };
        const color = resolveWedgeColor(
          { name: anchor.label, color: ext.color },
          i,
          AUTO_PALETTE,
        );
        const isActive = i === activeIdx;
        const [labelX, labelY] = polar(angles[i], LABEL_RADIUS);
        return (
          <g key={anchor.id}>
            <path
              data-testid="wedge"
              data-anchor-id={anchor.id}
              data-active={isActive ? 'true' : 'false'}
              d={wedgePath(startDeg, endDeg, WEDGE_RADIUS)}
              fill={color}
              fillOpacity={isActive ? 0.95 : 0.85}
              style={{
                cursor: 'pointer',
                filter: isActive ? 'brightness(1.25) drop-shadow(0 0 8px rgba(255,255,255,0.3))' : undefined,
                transition: 'filter 0.15s',
              }}
              onClick={() => handleWedgeClick(i)}
            />
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={14}
              fontWeight={700}
              fill="white"
              style={{ pointerEvents: 'none', textTransform: 'uppercase', letterSpacing: '0.5px' }}
            >
              {anchor.label}
            </text>
          </g>
        );
      })}

      {/* Outer ring track */}
      <circle
        cx={CENTER} cy={CENTER} r={TRACK_RADIUS}
        fill="none" stroke="#2a2a3a" strokeWidth={4}
      />

      {/* Active segment arc on outer ring */}
      <path
        d={arcPath(activeStart, activeEnd, TRACK_RADIUS)}
        fill="none"
        stroke={activeColor}
        strokeWidth={6}
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 6px currentColor)', opacity: 0.9 }}
      />

      {/* Position indicator */}
      <circle
        data-testid="indicator"
        cx={indicatorX} cy={indicatorY} r={INDICATOR_RADIUS}
        fill="white"
        style={{
          filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.8))',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
      />
    </svg>
  );
}
