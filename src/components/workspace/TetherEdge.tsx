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
  // Smooth step: a horizontal-vertical-horizontal staircase with a small
  // corner radius. Reads more like a wiring diagram than a bezier swoop.
  const [path] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 4,
  });
  // Counter-scale stroke + endpoint dots so the edge stays visible when the
  // workspace is zoomed out (same factor used for node chrome).
  const scale = useChromeScale();
  const strokeWidth = 1.5 * scale;
  const dot = 3 * scale;
  // Marching-ants pattern: layer-scope reads as near-solid (short gaps),
  // node-scope as a true dashed line. Both animate via the .tether-march
  // CSS rule (see index.css); animation respects prefers-reduced-motion.
  const isNodeScope = data?.scopeKind === 'node';
  const dashArray = isNodeScope ? `${3 * scale} ${3 * scale}` : `${5 * scale} ${2 * scale}`;
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
