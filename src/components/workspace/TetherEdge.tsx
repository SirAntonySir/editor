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
  // Marching-ants pattern. Layer-scope reads near-solid (5 on, 1 off),
  // node-scope reads as half-half dashes (3 on, 3 off). Pattern AND the
  // animation's offset shift both scale with chrome — they stay in lockstep
  // via the `--march-shift` CSS custom property, so the dash sum always
  // equals the per-cycle offset shift and the loop stays seamless at any
  // zoom.
  const isNodeScope = data?.scopeKind === 'node';
  const dashSum = 6 * scale;
  const dashArray = isNodeScope
    ? `${3 * scale} ${3 * scale}`
    : `${5 * scale} ${1 * scale}`;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={dashArray}
        className="tether-march"
        style={{
          stroke: 'var(--color-accent)',
          strokeWidth,
          fill: 'none',
          // Drives the keyframe's offset shift; equals the dash-pattern sum
          // so the animation loops without snapping at any zoom level.
          ['--march-shift' as string]: String(dashSum),
        }}
      />
      <circle cx={sourceX} cy={sourceY} r={dot} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={dot} fill="var(--color-accent)" />
    </>
  );
}
