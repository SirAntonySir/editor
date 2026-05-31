import { useState, useRef, useCallback, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { evaluateCubicSpline, DEFAULT_CURVE_POINTS, type CurvePoint } from '@/lib/curves';
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

const DEFAULT_POINTS: Record<Channel, CurvePoint[]> = {
  rgb: [...DEFAULT_CURVE_POINTS],
  red: [...DEFAULT_CURVE_POINTS],
  green: [...DEFAULT_CURVE_POINTS],
  blue: [...DEFAULT_CURVE_POINTS],
};

interface CurveEditorProps {
  value: CurvesValue;
  onChange: (next: CurvesValue) => void;
}

export function CurveEditor({ value, onChange }: CurveEditorProps) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingIdx = useRef<number | null>(null);

  const points = value[channel];

  const svgToPoint = useCallback((cx: number, cy: number): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (cy - rect.top) / rect.height)),
    };
  }, []);

  const setChannelPoints = useCallback(
    (pts: CurvePoint[]) => {
      onChange({ ...value, [channel]: pts });
    },
    [value, channel, onChange],
  );

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = svgToPoint(e.clientX, e.clientY);

    const idx = points.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );

    if (idx >= 0) {
      draggingIdx.current = idx;
    } else {
      const newPts = [...points, pt].sort((a, b) => a.x - b.x);
      const newIdx = newPts.indexOf(pt);
      draggingIdx.current = newIdx;
      setChannelPoints(newPts);
    }
  };

  // Document-level listeners so dragging continues outside the SVG
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingIdx.current === null) return;
      const pt = svgToPoint(e.clientX, e.clientY);
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

    const handleMouseUp = () => {
      draggingIdx.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [points, svgToPoint, setChannelPoints]);

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = svgToPoint(e.clientX, e.clientY);
    const idx = points.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );
    // Only remove interior points (keep endpoints at idx 0 and last)
    if (idx > 0 && idx < points.length - 1) {
      setChannelPoints(points.filter((_, i) => i !== idx));
    }
  };

  const isDefault = CHANNELS.every(
    (ch) =>
      value[ch].length === DEFAULT_POINTS[ch].length &&
      value[ch].every((p, i) => p.x === DEFAULT_POINTS[ch][i].x && p.y === DEFAULT_POINTS[ch][i].y),
  );

  const handleReset = () => {
    onChange({ ...IDENTITY_CURVES });
  };

  // Build SVG path from spline (200×200 viewBox)
  const lut = evaluateCubicSpline(points);
  const pathData = Array.from(lut)
    .map((y, i) => {
      const x = (i / 255) * 200;
      const yy = (1 - y) * 200;
      return i === 0 ? `M${x},${yy}` : `L${x},${yy}`;
    })
    .join(' ');

  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {/* Channel tab buttons */}
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

      {/* Curve SVG editor */}
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="w-full aspect-square bg-surface-secondary rounded cursor-crosshair"
        onMouseDown={handleMouseDown}
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

      {/* Reset button — only shown when any channel differs from identity */}
      {!isDefault && (
        <button
          onClick={handleReset}
          className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary
            bg-surface-secondary hover:bg-surface-secondary/80 rounded transition-colors cursor-default"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      )}
    </div>
  );
}
