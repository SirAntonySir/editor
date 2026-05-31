import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { useChromeScale } from '@/hooks/useChromeScale';

export interface TetherEdgeData extends Record<string, unknown> {
  scopeKind: 'layer' | 'node';
}

export type TetherEdgeType = Edge<TetherEdgeData, 'tether'>;

export function TetherEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<TetherEdgeType>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  // Counter-scale stroke + endpoint dots so the edge stays visible when the
  // workspace is zoomed out (same factor used for node chrome).
  const scale = useChromeScale();
  const strokeWidth = 1.5 * scale;
  const dot = 3 * scale;
  const dashArray = data?.scopeKind === 'node' ? `${3 * scale} ${3 * scale}` : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={dashArray}
        style={{ stroke: 'var(--color-accent)', strokeWidth, fill: 'none' }}
      />
      <circle cx={sourceX} cy={sourceY} r={dot} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={dot} fill="var(--color-accent)" />
    </>
  );
}
