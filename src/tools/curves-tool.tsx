import { useState, useCallback, useRef } from 'react';
import { Spline } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { useEditorStore } from '@/store';
import { evaluateCubicSpline, DEFAULT_CURVE_POINTS, type CurvePoint } from '@/lib/curves';

type Channel = 'rgb' | 'red' | 'green' | 'blue';

const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: '#888',
  red: '#ff4444',
  green: '#44bb44',
  blue: '#4488ff',
};

function CurvesPanel() {
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const [activeChannel, setActiveChannel] = useState<Channel>('rgb');
  const [points, setPoints] = useState<Record<Channel, CurvePoint[]>>({
    rgb: [...DEFAULT_CURVE_POINTS],
    red: [...DEFAULT_CURVE_POINTS],
    green: [...DEFAULT_CURVE_POINTS],
    blue: [...DEFAULT_CURVE_POINTS],
  });
  const draggingIdx = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const updateCurves = useCallback(
    (newPoints: Record<Channel, CurvePoint[]>) => {
      if (!activeLayerId) return;
      const params: Record<string, Float32Array> = {};
      for (const ch of ['rgb', 'red', 'green', 'blue'] as Channel[]) {
        params[ch] = evaluateCubicSpline(newPoints[ch]);
      }
      useEditorStore.getState().setAdjustment(activeLayerId, 'curves', params);
    },
    [activeLayerId],
  );

  const channelPoints = points[activeChannel];

  const svgToPoint = (e: React.MouseEvent<SVGSVGElement>): CurvePoint => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = svgToPoint(e);

    // Check if clicking near an existing point
    const idx = channelPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );

    if (idx >= 0) {
      draggingIdx.current = idx;
    } else {
      // Add new point
      const newPts = [...channelPoints, pt].sort((a, b) => a.x - b.x);
      const newIdx = newPts.indexOf(pt);
      draggingIdx.current = newIdx;
      const next = { ...points, [activeChannel]: newPts };
      setPoints(next);
      updateCurves(next);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingIdx.current === null) return;
    const pt = svgToPoint(e);
    const idx = draggingIdx.current;
    const newPts = [...channelPoints];

    // Don't allow dragging first/last point's X
    if (idx === 0) {
      newPts[idx] = { x: 0, y: pt.y };
    } else if (idx === newPts.length - 1) {
      newPts[idx] = { x: 1, y: pt.y };
    } else {
      newPts[idx] = pt;
    }

    const next = { ...points, [activeChannel]: newPts };
    setPoints(next);
    updateCurves(next);
  };

  const handleMouseUp = () => {
    draggingIdx.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = svgToPoint(e);
    const idx = channelPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );
    // Remove point (but not first or last)
    if (idx > 0 && idx < channelPoints.length - 1) {
      const newPts = channelPoints.filter((_, i) => i !== idx);
      const next = { ...points, [activeChannel]: newPts };
      setPoints(next);
      updateCurves(next);
    }
  };

  // Build SVG path from spline
  const lut = evaluateCubicSpline(channelPoints);
  const pathData = Array.from(lut)
    .map((y, i) => {
      const x = (i / 255) * 200;
      const yy = (1 - y) * 200;
      return i === 0 ? `M${x},${yy}` : `L${x},${yy}`;
    })
    .join(' ');

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex gap-1">
        {(['rgb', 'red', 'green', 'blue'] as Channel[]).map((ch) => (
          <button
            key={ch}
            onClick={() => setActiveChannel(ch)}
            className={`px-2 py-0.5 text-xs rounded capitalize transition-colors ${
              activeChannel === ch
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface-secondary'
            }`}
          >
            {ch === 'rgb' ? 'RGB' : ch}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="w-full aspect-square bg-surface-secondary rounded cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* Diagonal reference line */}
        <line x1="0" y1="200" x2="200" y2="0" stroke="var(--color-separator)" strokeWidth="1" />
        {/* Grid lines */}
        <line x1="50" y1="0" x2="50" y2="200" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="100" y1="0" x2="100" y2="200" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="150" y1="0" x2="150" y2="200" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="0" y1="50" x2="200" y2="50" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="0" y1="100" x2="200" y2="100" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1="0" y1="150" x2="200" y2="150" stroke="var(--color-separator)" strokeWidth="0.5" />
        {/* Curve */}
        <path d={pathData} fill="none" stroke={CHANNEL_COLORS[activeChannel]} strokeWidth="2" />
        {/* Control points */}
        {channelPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x * 200}
            cy={(1 - p.y) * 200}
            r="5"
            fill="white"
            stroke={CHANNEL_COLORS[activeChannel]}
            strokeWidth="2"
            className="cursor-grab"
          />
        ))}
      </svg>
    </div>
  );
}

export const CurvesTool: ToolDefinition = {
  name: 'curves',
  label: 'Curves',
  icon: Spline,
  category: 'adjust',
  OptionsPanel: CurvesPanel,
};
