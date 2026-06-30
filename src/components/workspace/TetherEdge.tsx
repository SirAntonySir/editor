import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface TetherEdgeData extends Record<string, unknown> {
  scopeKind: 'layer' | 'node';
}

export type TetherEdgeType = Edge<TetherEdgeData, 'tether'>;

const STROKE_WIDTH = 1.5;   // canvas units
const DOT_RADIUS = 3;        // canvas units
const CURVATURE = 0.3;       // Bézier bow: 0 = straight, ~0.25 RF default, higher = more sweep
const DASH_SUM = 6;          // canvas units; matches the pattern total below

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
  // Tether edges live in canvas space (Figma model). Stroke width, corner
  // radius, and endpoint dot size are constants in canvas units; React Flow's
  // zoom transform handles screen-pixel conversion. At zoom=1 these match
  // their previous appearance; below 1 they get thinner, above 1 thicker.
  // Bézier curve that leaves each handle along its direction (sourcePosition /
  // targetPosition come from pickTetherHandles), giving an organic tether
  // instead of orthogonal elbows.
  const [path] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: CURVATURE,
  });
  // Marching-ants pattern. Layer-scope reads near-solid (5 on, 1 off),
  // node-scope reads as half-half dashes (3 on, 3 off). The dash sum equals
  // the per-cycle offset shift via the `--march-shift` CSS variable, so the
  // loop is seamless.
  const isNodeScope = data?.scopeKind === 'node';
  const dashArray = isNodeScope ? '3 3' : '5 1';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={dashArray}
        className="tether-march"
        style={{
          stroke: 'var(--color-accent)',
          strokeWidth: STROKE_WIDTH,
          fill: 'none',
          ['--march-shift' as string]: String(DASH_SUM),
        }}
      />
      <circle cx={sourceX} cy={sourceY} r={DOT_RADIUS} fill="var(--color-accent)" />
      <circle cx={targetX} cy={targetY} r={DOT_RADIUS} fill="var(--color-accent)" />
    </>
  );
}
