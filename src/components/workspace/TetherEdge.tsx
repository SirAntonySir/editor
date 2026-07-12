import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Eye } from 'lucide-react';
import { useEditorStore } from '@/store';

export interface TetherEdgeData extends Record<string, unknown> {
  scopeKind: 'layer' | 'node';
  /** 'extracted' renders a calm, semi-transparent grey provenance connector
   *  from an extracted image node back to its source (not the accent tether).
   *  'hub' marks a break-out satellite → parent fused-widget tether; it reuses
   *  the default accent styling (Phase B adds category-tinted strands). */
  variant?: 'extracted' | 'hub';
  /** For widget tethers: the (widget, layer) target this edge represents, so
   *  reconnect / delete handlers don't have to parse the edge id. */
  widgetId?: string;
  layerId?: string;
}

export type TetherEdgeType = Edge<TetherEdgeData, 'tether'>;

const STROKE_WIDTH = 1.5;   // canvas units
const DOT_RADIUS = 3;        // canvas units
const CURVATURE = 0.3;       // Bézier bow: 0 = straight, ~0.25 RF default, higher = more sweep
const DASH_SUM = 6;          // canvas units; matches the pattern total below

export function TetherEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<TetherEdgeType>) {
  // Tether edges live in canvas space (Figma model). Stroke width, corner
  // radius, and endpoint dot size are constants in canvas units; React Flow's
  // zoom transform handles screen-pixel conversion. At zoom=1 these match
  // their previous appearance; below 1 they get thinner, above 1 thicker.
  // Bézier curve that leaves each handle along its direction (sourcePosition /
  // targetPosition come from pickTetherHandles), giving an organic tether
  // instead of orthogonal elbows.
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: CURVATURE,
  });
  // For an extracted provenance edge, resolve which endpoint is the extracted
  // CHILD (the node carrying `sourceImageNodeId` pointing at the other end) so
  // the mirror-preview toggle keys off it.
  const extractedChildId = useEditorStore((s) => {
    if (s.imageNodes[source]?.sourceImageNodeId === target) return source;
    if (s.imageNodes[target]?.sourceImageNodeId === source) return target;
    return null;
  });
  const mirrorOn = useEditorStore((s) => (extractedChildId ? !!s.mirrorPreview[extractedChildId] : false));
  const toggleMirrorPreview = useEditorStore((s) => s.toggleMirrorPreview);
  // Marching-ants pattern. Layer-scope reads near-solid (5 on, 1 off),
  // node-scope reads as half-half dashes (3 on, 3 off). The dash sum equals
  // the per-cycle offset shift via the `--march-shift` CSS variable, so the
  // loop is seamless.
  const isNodeScope = data?.scopeKind === 'node';
  const isExtracted = data?.variant === 'extracted';
  // Extracted provenance connector: calm semi-transparent grey, static dashes
  // (no marching-ants), so it reads as a quiet "came from here" link rather
  // than an active accent tether.
  const stroke = isExtracted
    ? 'color-mix(in srgb, var(--color-text-secondary) 55%, transparent)'
    : 'var(--color-accent)';
  const dashArray = isExtracted ? '4 3' : isNodeScope ? '3 3' : '5 1';
  // Selected widget tethers read heavier + solid so the ⌫-target is obvious.
  const strokeWidth = selected ? STROKE_WIDTH * 1.8 : STROKE_WIDTH;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        strokeDasharray={selected ? undefined : dashArray}
        className={isExtracted || selected ? undefined : 'tether-march'}
        style={{
          stroke,
          strokeWidth,
          fill: 'none',
          ['--march-shift' as string]: String(DASH_SUM),
        }}
      />
      <circle cx={sourceX} cy={sourceY} r={DOT_RADIUS} fill={stroke} />
      <circle cx={targetX} cy={targetY} r={DOT_RADIUS} fill={stroke} />
      {/* Mirror-preview toggle at the edge midpoint (extracted edges only):
          previews the child's edited pixels back on the source before rejoin. */}
      {isExtracted && extractedChildId && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`nodrag nopan inline-flex items-center justify-center w-[18px] h-[18px]
              rounded-full border bg-surface shadow-sm cursor-pointer transition-colors ${
                mirrorOn
                  ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
                  : 'text-text-secondary border-separator hover:text-text-primary'
              }`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            aria-label={mirrorOn ? 'Hide preview on source' : 'Preview edits on source'}
            aria-pressed={mirrorOn}
            title={mirrorOn ? 'Hide preview on source' : 'Preview edits on source'}
            onClick={(e) => { e.stopPropagation(); toggleMirrorPreview(extractedChildId); }}
          >
            <Eye size={11} aria-hidden />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
