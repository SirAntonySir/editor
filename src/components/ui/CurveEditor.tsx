import { useState, useRef, useCallback } from 'react';
import { evaluateCubicSplineMemo, type CurvePoint } from '@/lib/curves';
import { IDENTITY_CURVES } from '@/types/widget';
import type { CurvesValue } from '@/types/widget';

type Channel = keyof CurvesValue; // 'rgb' | 'red' | 'green' | 'blue'
const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];

const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: '#888',
  red: '#ff4444',
  green: '#44bb44',
  blue: '#4488ff',
};

interface CurveEditorProps {
  value: CurvesValue;
  onChange: (next: CurvesValue) => void;
  /** When set, hides the channel-selector tabs and locks the editor to this
   *  single channel. Used by the registry-driven panel (Option A: 4 separate
   *  CurveEditor instances, one per binding). */
  channel?: Channel;
}

/** Normalise a CurvesValue: defaults each missing channel to the identity
 *  ramp. Defends against malformed values arriving from older fused-template
 *  resolvers (e.g. bw_cinematic / teal_orange / sky_recovery emit a binding
 *  whose value collapses to `0` because the framework midpoints the missing
 *  `points` key). Without this guard, accessing `value[channel].length`
 *  crashes the editor and takes the inspector with it. */
function normalizeCurvesValue(v: unknown): CurvesValue {
  const src = (v && typeof v === 'object' ? v : {}) as Partial<CurvesValue>;
  return {
    rgb: src.rgb ?? [...IDENTITY_CURVES.rgb],
    red: src.red ?? [...IDENTITY_CURVES.red],
    green: src.green ?? [...IDENTITY_CURVES.green],
    blue: src.blue ?? [...IDENTITY_CURVES.blue],
  };
}

export function CurveEditor({ value, onChange, channel: lockedChannel }: CurveEditorProps) {
  const [internalChannel, setInternalChannel] = useState<Channel>('rgb');
  // When `lockedChannel` is provided the component is single-channel: the
  // tabs are hidden and the active channel is always the locked one.
  const channel: Channel = lockedChannel ?? internalChannel;
  const setChannel = lockedChannel ? (_: Channel) => { /* no-op when locked */ } : setInternalChannel;
  const draggingIdx = useRef<number | null>(null);

  // Normalise upstream once per render so every downstream read sees the
  // full four-channel shape.
  const safeValue = normalizeCurvesValue(value);
  const points = safeValue[channel];

  // Take the SVG element from the event itself rather than dereffing
  // svgRef — currentTarget can never be null inside a pointer handler
  // for this element, so we get the non-assertion property safely.
  const svgToPoint = useCallback((svg: SVGSVGElement, cx: number, cy: number): CurvePoint => {
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height)),
    };
  }, []);

  const setChannelPoints = useCallback(
    (pts: CurvePoint[]) => {
      // Spread from safeValue so a malformed upstream value (number / null /
      // partial object) doesn't propagate forward — Apply now always writes
      // a complete four-channel CurvesValue.
      onChange({ ...safeValue, [channel]: pts });
    },
    [safeValue, channel, onChange],
  );

  // Pointer events with per-SVG capture: each CurveEditor owns its own
  // pointer stream once a drag starts. This is the fix for multi-editor
  // layouts (2×2, 4×1) — the previous document-level mouse listeners had
  // every mounted editor's handler fire for every move, with re-registration
  // churn on each `points` change.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = svgToPoint(e.currentTarget, e.clientX, e.clientY);
    const idx = points.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );
    if (idx >= 0) {
      draggingIdx.current = idx;
    } else {
      const newPts = [...points, pt].sort((a, b) => a.x - b.x);
      draggingIdx.current = newPts.indexOf(pt);
      setChannelPoints(newPts);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIdx.current === null) return;
    const pt = svgToPoint(e.currentTarget, e.clientX, e.clientY);
    const idx = draggingIdx.current;
    const newPts = [...points];
    if (idx === 0) {
      // Left endpoint: lock x to 0, only y moves
      newPts[idx] = { x: 0, y: pt.y };
    } else if (idx === newPts.length - 1) {
      // Right endpoint: lock x to 1, only y moves
      newPts[idx] = { x: 1, y: pt.y };
    } else {
      newPts[idx] = pt;
    }
    setChannelPoints(newPts);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    draggingIdx.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Browser may have already released capture on pointerup; ignore.
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = svgToPoint(e.currentTarget, e.clientX, e.clientY);
    const idx = points.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );
    // Only remove interior points (keep endpoints at idx 0 and last)
    if (idx > 0 && idx < points.length - 1) {
      setChannelPoints(points.filter((_, i) => i !== idx));
    }
  };

  // Build SVG path from spline (200×200 viewBox). Memoized: the editor
  // re-renders per pointermove during a drag, and only the dragged channel's
  // points actually change.
  const lut = evaluateCubicSplineMemo(points);
  const pathData = Array.from(lut)
    .map((y, i) => {
      const x = (i / 255) * 200;
      const yy = (1 - y) * 200;
      return i === 0 ? `M${x},${yy}` : `L${x},${yy}`;
    })
    .join(' ');

  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {/* Channel tab buttons — hidden when a channel is locked from outside */}
      {!lockedChannel && (
        <div className="flex gap-1">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`px-2 py-0.5 text-xs rounded capitalize transition-colors ${
                channel === ch
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:bg-surface-secondary'
              }`}
            >
              {ch === 'rgb' ? 'RGB' : ch}
            </button>
          ))}
        </div>
      )}

      {/* Curve SVG editor */}
      <svg
        viewBox="0 0 200 200"
        className="w-full aspect-square bg-surface-secondary rounded cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* Diagonal reference line */}
        <line x1="0" y1="200" x2="200" y2="0" stroke="var(--color-separator)" strokeWidth="1" />
        {/* Vertical grid lines */}
        <line x1="50" y1="0" x2="50" y2="200" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="100" y1="0" x2="100" y2="200" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="150" y1="0" x2="150" y2="200" stroke="var(--color-separator)" strokeWidth="0.5" />
        {/* Horizontal grid lines */}
        <line x1="0" y1="50" x2="200" y2="50" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="0" y1="100" x2="200" y2="100" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="0" y1="150" x2="200" y2="150" stroke="var(--color-separator)" strokeWidth="0.5" />
        {/* Spline curve */}
        <path d={pathData} fill="none" stroke={CHANNEL_COLORS[channel]} strokeWidth="2" />
        {/* Control point circles */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * 200}
            cy={(1 - p.y) * 200}
            r="5"
            fill="white"
            stroke={CHANNEL_COLORS[channel]}
            strokeWidth="2"
            className="cursor-grab"
          />
        ))}
      </svg>

    </div>
  );
}
