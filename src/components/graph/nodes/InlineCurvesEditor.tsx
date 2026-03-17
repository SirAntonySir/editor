import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '@/store';
import { evaluateCubicSpline } from '@/lib/curves';
import { useCurvePoints, type CurvePointsMap } from '@/lib/curve-points-store';
import type { CurvePoint } from '@/lib/curves';

type Channel = 'rgb' | 'red' | 'green' | 'blue';

const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: '#888',
  red: '#ff4444',
  green: '#44bb44',
  blue: '#4488ff',
};

const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];

/**
 * Compact inline curves editor for graph nodes.
 * 120x120 SVG with mini channel tabs.
 * Shares control points with CurvesPanel via curve-points-store.
 */
export function InlineCurvesEditor({ layerId }: { layerId: string }) {
  const [activeChannel, setActiveChannel] = useState<Channel>('rgb');
  const [points, setPoints] = useCurvePoints(layerId);
  const draggingIdx = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const updateCurves = useCallback(
    (newPoints: CurvePointsMap) => {
      setPoints(newPoints);
      const params: Record<string, Float32Array> = {};
      for (const ch of CHANNELS) {
        params[ch] = evaluateCubicSpline(newPoints[ch]);
      }
      useEditorStore.getState().setAdjustment(layerId, 'curves', params);
    },
    [layerId, setPoints],
  );

  const channelPoints = points[activeChannel];

  const svgToPoint = useCallback((clientX: number, clientY: number): CurvePoint => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)),
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const pt = svgToPoint(e.clientX, e.clientY);
    const idx = channelPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.06 && Math.abs(p.y - pt.y) < 0.06,
    );

    if (idx >= 0) {
      draggingIdx.current = idx;
    } else {
      const newPts = [...channelPoints, pt].sort((a, b) => a.x - b.x);
      const newIdx = newPts.indexOf(pt);
      draggingIdx.current = newIdx;
      const next = { ...points, [activeChannel]: newPts };
      updateCurves(next);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingIdx.current === null) return;
      const pt = svgToPoint(e.clientX, e.clientY);
      const idx = draggingIdx.current;

      const currentPts = points[activeChannel];
      const newPts = [...currentPts];
      if (idx === 0) {
        newPts[idx] = { x: 0, y: pt.y };
      } else if (idx === newPts.length - 1) {
        newPts[idx] = { x: 1, y: pt.y };
      } else {
        newPts[idx] = pt;
      }
      const next = { ...points, [activeChannel]: newPts };
      updateCurves(next);
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
  }, [activeChannel, svgToPoint, updateCurves, points]);

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const pt = svgToPoint(e.clientX, e.clientY);
    const idx = channelPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.06 && Math.abs(p.y - pt.y) < 0.06,
    );
    if (idx > 0 && idx < channelPoints.length - 1) {
      const newPts = channelPoints.filter((_, i) => i !== idx);
      const next = { ...points, [activeChannel]: newPts };
      updateCurves(next);
    }
  };

  const lut = evaluateCubicSpline(channelPoints);
  const size = 120;
  const pathData = Array.from(lut)
    .map((y, i) => {
      const x = (i / 255) * size;
      const yy = (1 - y) * size;
      return i === 0 ? `M${x},${yy}` : `L${x},${yy}`;
    })
    .join(' ');

  return (
    <div className="px-3 py-2 flex flex-col gap-1.5 nodrag nowheel">
      <div className="flex gap-0.5">
        {CHANNELS.map((ch) => (
          <button
            key={ch}
            onClick={(e) => { e.stopPropagation(); setActiveChannel(ch); }}
            className={`px-1.5 py-0.5 text-[9px] rounded capitalize transition-colors ${
              activeChannel === ch
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface-secondary'
            }`}
          >
            {ch === 'rgb' ? 'RGB' : ch.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        className="w-full aspect-square bg-surface-secondary rounded cursor-crosshair"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <line x1="0" y1={size} x2={size} y2="0" stroke="var(--color-separator)" strokeWidth="0.5" />
        <line x1={size / 4} y1="0" x2={size / 4} y2={size} stroke="var(--color-separator)" strokeWidth="0.3" />
        <line x1={size / 2} y1="0" x2={size / 2} y2={size} stroke="var(--color-separator)" strokeWidth="0.3" />
        <line x1={(3 * size) / 4} y1="0" x2={(3 * size) / 4} y2={size} stroke="var(--color-separator)" strokeWidth="0.3" />
        <line x1="0" y1={size / 4} x2={size} y2={size / 4} stroke="var(--color-separator)" strokeWidth="0.3" />
        <line x1="0" y1={size / 2} x2={size} y2={size / 2} stroke="var(--color-separator)" strokeWidth="0.3" />
        <line x1="0" y1={(3 * size) / 4} x2={size} y2={(3 * size) / 4} stroke="var(--color-separator)" strokeWidth="0.3" />
        <path d={pathData} fill="none" stroke={CHANNEL_COLORS[activeChannel]} strokeWidth="1.5" />
        {channelPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x * size}
            cy={(1 - p.y) * size}
            r="4"
            fill="white"
            stroke={CHANNEL_COLORS[activeChannel]}
            strokeWidth="1.5"
            className="cursor-grab"
          />
        ))}
      </svg>
    </div>
  );
}
