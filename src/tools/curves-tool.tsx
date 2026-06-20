import { useState, useCallback, useRef, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ToolDefinition } from '@/types/tool';

const CurvesIcon = createMaterialIcon('show_chart');
import { useEditorStore } from '@/store';
import { evaluateCubicSpline, DEFAULT_CURVE_POINTS, type CurvePoint } from '@/lib/curves';
import { useCurvePoints, type CurvePointsMap } from '@/lib/curve-points-store';

type Channel = 'rgb' | 'red' | 'green' | 'blue';

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

export function CurvesPanel({ layerId: layerIdProp }: { layerId?: string } = {}) {
  const storeLayerId = useEditorStore((s) => s.activeLayerId);
  const activeLayerId = layerIdProp ?? storeLayerId;
  const [activeChannel, setActiveChannel] = useState<Channel>('rgb');
  const [points, setPoints] = useCurvePoints(activeLayerId ?? '');
  const draggingIdx = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const updateCurves = useCallback(
    (newPoints: CurvePointsMap) => {
      if (!activeLayerId) return;
      setPoints(newPoints);
      // TODO: route curve updates through backendTools.set_widget_param when
      // curves widget exists in the backend snapshot (T26 smoke test).
      // For now, update the local curve-points store for immediate visual feedback.
    },
    [activeLayerId, setPoints],
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
    const pt = svgToPoint(e.clientX, e.clientY);

    const idx = channelPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
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

  // Use document-level listeners so dragging continues outside the SVG
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
    const pt = svgToPoint(e.clientX, e.clientY);
    const idx = channelPoints.findIndex(
      (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
    );
    if (idx > 0 && idx < channelPoints.length - 1) {
      const newPts = channelPoints.filter((_, i) => i !== idx);
      const next = { ...points, [activeChannel]: newPts };
      updateCurves(next);
    }
  };

  const isDefault = (['rgb', 'red', 'green', 'blue'] as Channel[]).every(
    (ch) =>
      points[ch].length === DEFAULT_POINTS[ch].length &&
      points[ch].every((p, i) => p.x === DEFAULT_POINTS[ch][i].x && p.y === DEFAULT_POINTS[ch][i].y),
  );

  const reset = () => {
    const next = {
      rgb: [...DEFAULT_CURVE_POINTS],
      red: [...DEFAULT_CURVE_POINTS],
      green: [...DEFAULT_CURVE_POINTS],
      blue: [...DEFAULT_CURVE_POINTS],
    };
    updateCurves(next);
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
    <div className="p-2 flex flex-col gap-1.5">
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
      {!isDefault && (
        <button
          onClick={reset}
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

export const CurvesTool: ToolDefinition = {
  name: 'curves',
  label: 'Curves',
  icon: CurvesIcon,
  category: 'adjust',
  processingId: 'curves',
  onActivate: () => {
    // activeObjectId is already set by the canvas click/cycle; nothing extra needed.
  },
};
