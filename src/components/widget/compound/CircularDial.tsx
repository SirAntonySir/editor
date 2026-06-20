import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor } from '@/lib/perceptual-dial/types';
import {
  activeWedgeIndexFromAngle,
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
  /** Rendered width/height in px. The SVG viewBox is fixed at 320; the dial
   *  scales to fit. Defaults to a compact 220 — the canvas widget shell isn't
   *  the whole panel, it lives inside a card on the workspace. */
  size?: number;
}

const CENTER = 160;
const VIEWBOX = 320;
const WEDGE_RADIUS = 110;
const TRACK_RADIUS = 135;
const INDICATOR_RADIUS = 6;
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

export function CircularDial({ anchors, position, onPositionChange, size = 220 }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // While dragging we track the raw cursor angle locally so the indicator
  // can follow the cursor smoothly across the seam, even when the underlying
  // position prop snaps (e.g. season: positions span [0, 1] with no cyclic
  // gap, so the seam quarter-arc would otherwise pin the indicator to
  // angles[last]). On release we fall back to the prop-derived angle.
  const [dragAngle, setDragAngle] = useState<number | null>(null);

  // rAF-throttled state. Pointer events fire faster than the display refresh;
  // batching state updates per frame keeps re-renders bounded to ~60/120fps
  // instead of >300/s on a hi-poll trackpad. Also de-noises the upstream
  // applyOptimistic burst, which has to re-fan out to every store subscriber.
  const pendingAngleRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const anchorsLike = useMemo(
    () => anchors.map((a) => {
      const ext = a as Anchor & { color?: string };
      return { position: a.position[0], name: a.label, color: ext.color };
    }),
    [anchors],
  );

  const angles = useMemo(() => anchorAngles(anchors.length), [anchors.length]);
  const wedgeSpan = 360 / Math.max(1, anchors.length);

  const propAngle = useMemo(
    () => positionToIndicatorAngle(anchorsLike, position),
    [anchorsLike, position],
  );
  // While dragging, the cursor wins. Otherwise the prop drives the indicator.
  const indicatorAngle = dragAngle ?? propAngle;
  const [indicatorX, indicatorY] = polar(indicatorAngle, TRACK_RADIUS);

  // Highlight the wedge whose angular slice the indicator currently sits in.
  // Driving this from the indicator angle (rather than the raw position) keeps
  // the highlight switching exactly at the visual wedge boundaries, regardless
  // of how irregularly anchor positions are distributed in [0, 1].
  const activeIdx = activeWedgeIndexFromAngle(anchors.length, indicatorAngle);

  const handleWedgeClick = useCallback((i: number) => {
    onPositionChange(anchors[i].position[0]);
  }, [anchors, onPositionChange]);

  function cursorAngle(e: React.PointerEvent): number | null {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * VIEWBOX;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEWBOX;
    const dx = sx - CENTER;
    const dy = sy - CENTER;
    // atan2 returns radians where 0 = +x (right). We want 0 = top, clockwise.
    let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if (deg < 0) deg += 360;
    return deg;
  }

  /** Schedule a state update on the next animation frame, coalescing multiple
   *  pointer events that land within the same frame into one React render. */
  const flushAngle = useCallback(() => {
    rafRef.current = null;
    const deg = pendingAngleRef.current;
    if (deg == null) return;
    setDragAngle(deg);
    onPositionChange(angleToPosition(anchorsLike, deg));
  }, [anchorsLike, onPositionChange]);

  const scheduleAngle = useCallback((deg: number) => {
    pendingAngleRef.current = deg;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flushAngle);
  }, [flushAngle]);

  // Cancel any in-flight rAF on unmount so the callback can't fire post-unmount.
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const deg = cursorAngle(e);
    if (deg == null) return;
    setDragAngle(deg);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragAngle == null) return;
    const deg = cursorAngle(e);
    if (deg == null) return;
    scheduleAngle(deg);
  }, [dragAngle, scheduleAngle]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Flush any pending angle so the final position commits even if the
    // pointer-up lands inside the same frame as the last move.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      flushAngle();
    }
    setDragAngle(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, [flushAngle]);

  const dragging = dragAngle != null;

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
      // `nodrag` + `nopan` opt the dial out of React Flow's pointer-handling
      // so wedge clicks + indicator drags reach our handlers instead of
      // triggering node drag / canvas pan. RF treats these classes as
      // "interactive content — leave it alone".
      className="circular-dial nodrag nopan"
      style={{
        width: '100%',
        maxWidth: size,
        aspectRatio: '1 / 1',
        display: 'block',
        margin: '0 auto',
        userSelect: 'none',
      }}
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
              fillOpacity={isActive ? 1 : 0.78}
              style={{ cursor: 'pointer' }}
              onClick={() => handleWedgeClick(i)}
            />
            <text
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fontWeight={600}
              fill="white"
              style={{
                pointerEvents: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                // Cheap legibility on coloured fills — paint-order keeps the
                // stroke behind the fill so the letterforms stay crisp,
                // unlike drop-shadow which forces a filter region per glyph.
                paintOrder: 'stroke',
                stroke: 'rgba(0, 0, 0, 0.18)',
                strokeWidth: 2,
              }}
            >
              {anchor.label}
            </text>
          </g>
        );
      })}

      {/* Outer ring track — hairline in the surface separator colour so it
          reads as structure, not weight. */}
      <circle
        cx={CENTER} cy={CENTER} r={TRACK_RADIUS}
        fill="none"
        stroke="var(--color-separator)"
        strokeWidth={2}
      />

      {/* Active segment arc on outer ring — coloured wedge accent, no filter. */}
      <path
        d={arcPath(activeStart, activeEnd, TRACK_RADIUS)}
        fill="none"
        stroke={activeColor}
        strokeWidth={4}
        strokeLinecap="round"
        opacity={0.9}
      />

      {/* Position indicator — small white dot with a thin border-strong outline
          (no drop-shadow filter, which is the main cause of jank during drag). */}
      <circle
        data-testid="indicator"
        cx={indicatorX} cy={indicatorY} r={INDICATOR_RADIUS}
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth={1.5}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
      />
    </svg>
  );
}
