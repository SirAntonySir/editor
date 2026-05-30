import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

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
  const dashArray = data?.scopeKind === 'node' ? '3 3' : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={dashArray}
        style={{ stroke: 'var(--color-accent)', strokeWidth: 1.5, fill: 'none' }}
      />
      <circle cx={sourceX} cy={sourceY} r={3} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={3} fill="var(--color-accent)" />
    </>
  );
}
