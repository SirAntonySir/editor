import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
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
  // Counter-scale stroke + corner radius + endpoint dots so they stay
  // readable when the workspace is zoomed out (same factor used for node
  // chrome). Path geometry is in flow units, so radius needs the scale boost
  // or it renders as a sharp corner at typical zooms.
  const scale = useChromeScale();
  const strokeWidth = 1.5 * scale;
  const dot = 3 * scale;
  const [path] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 12 * scale,
  });
  // Marching-ants pattern: both scopes sum to 6 path-units so the CSS
  // animation's -6 offset shift completes a full pattern per cycle (no
  // jump on loop). Layer-scope reads near-solid (5 on, 1 off); node-scope
  // reads as half-half dashes (3 on, 3 off). Pattern is in flow units so
  // it does NOT scale with chrome — that's intentional, otherwise the
  // dash sum drifts from the animation's offset shift and the loop jumps.
  const isNodeScope = data?.scopeKind === 'node';
  const dashArray = isNodeScope ? '3 3' : '5 1';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={dashArray}
        className="tether-march"
        style={{ stroke: 'var(--color-accent)', strokeWidth, fill: 'none' }}
      />
      <circle cx={sourceX} cy={sourceY} r={dot} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={dot} fill="var(--color-accent)" />
    </>
  );
}
