import { type EdgeProps, BaseEdge, getBezierPath } from '@xyflow/react';

export function CustomEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  ...rest
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <BaseEdge
      {...rest}
      path={edgePath}
      style={{ stroke: 'var(--color-accent)', strokeWidth: 2, strokeOpacity: 0.6 }}
    />
  );
}
