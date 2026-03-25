import type { ConnectionLineComponentProps } from '@xyflow/react';

export function CustomConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  return (
    <g>
      <path
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeOpacity={0.6}
        d={`M${fromX},${fromY} C ${fromX} ${toY} ${fromX} ${toY} ${toX},${toY}`}
      />
    </g>
  );
}
