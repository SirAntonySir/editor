import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { useEditorStore } from '@/store';
import {
  sampleBezier,
  unitNormals,
  braidOffset,
  liftOffset,
  buildStrandPath,
  strandApex,
  BRAID_SAMPLES,
  type TetherStrand,
} from '@/lib/tether-strands';

export interface TetherEdgeData extends Record<string, unknown> {
  scopeKind: 'layer' | 'node';
  /** 'extracted' renders a calm, semi-transparent grey provenance connector
   *  from an extracted image node back to its source (not the accent tether).
   *  'hub' marks a break-out satellite → parent fused-widget tether; it reuses
   *  the default accent styling, tinted by `strandColorVar` when present. */
  variant?: 'extracted' | 'hub';
  /** For widget tethers: the (widget, layer) target this edge represents, so
   *  reconnect / delete handlers don't have to parse the edge id. */
  widgetId?: string;
  layerId?: string;
  /** Fused-widget braid strands (one per op node). ≥2 → braided render; ===1 →
   *  single path in that strand's tint; absent/empty → plain single tether. */
  strands?: TetherStrand[];
  /** Hub-edge single-strand tint (Phase C satellites): `var(--strand-<cat>)`. */
  strandColorVar?: string;
}

export type TetherEdgeType = Edge<TetherEdgeData, 'tether'>;

const STROKE_WIDTH = 1.5;   // canvas units
const STRAND_WIDTH = 1.1;    // canvas units; thinner than the single tether
const DOT_RADIUS = 3;        // canvas units
const APEX_DOT_RADIUS = 2.5; // canvas units; separated-strand apex marker
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
  const isHub = data?.variant === 'hub';
  const strands = data?.strands;
  // Extracted provenance connector: calm semi-transparent grey, static dashes
  // (no marching-ants), so it reads as a quiet "came from here" link rather
  // than an active accent tether. Hub edges tint to the op's category when the
  // derivation supplied `strandColorVar` (Phase C satellites).
  const stroke = isExtracted
    ? 'color-mix(in srgb, var(--color-text-secondary) 55%, transparent)'
    : isHub && data?.strandColorVar
      ? data.strandColorVar
      : 'var(--color-accent)';
  const dashArray = isExtracted ? '4 3' : isNodeScope ? '3 3' : '5 1';
  // Selected widget tethers read heavier + solid so the ⌫-target is obvious.
  const strokeWidth = selected ? STROKE_WIDTH * 1.8 : STROKE_WIDTH;

  // ── Braid geometry (fused widgets: strands.length >= 1) ─────────────────
  // Sample the same cubic the BaseEdge path draws (recomputing RF's controls
  // analytically), memoised on the endpoint coords + strand identity so a drag
  // only re-solves geometry when something actually moved. 48 samples × ≤5
  // strands is trivial per frame.
  const braid = useMemo(() => {
    if (!strands || strands.length === 0) return null;
    const base = sampleBezier(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      { source: sourcePosition, target: targetPosition },
      CURVATURE,
      BRAID_SAMPLES,
    );
    const normals = unitNormals(base);
    // Only the un-separated strands take braid phases (evenly spread over 2π).
    const woven = strands.filter((st) => !st.separated);
    const n = Math.max(woven.length, 1);
    const paths = strands.map((st) => {
      if (st.separated) {
        // Separated: lift out on the negative normal (away from the braid),
        // solid accent-blue, apex dot at s=0.5.
        const offsetFn = (s: number) => -liftOffset(s);
        return {
          strand: st,
          d: buildStrandPath(base, normals, offsetFn),
          apex: strandApex(base, normals, offsetFn),
          separated: true,
        };
      }
      const idx = woven.indexOf(st);
      const phase = (idx * 2 * Math.PI) / n;
      const offsetFn = (s: number) => braidOffset(s, phase);
      return { strand: st, d: buildStrandPath(base, normals, offsetFn), apex: null, separated: false };
    });
    return paths;
  }, [strands, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  if (braid) {
    // Single-strand fused widget: no weave, just the category tint on the path.
    const single = strands!.length === 1;
    const strandWidth = selected ? STRAND_WIDTH * 1.4 : single ? STROKE_WIDTH : STRAND_WIDTH;
    return (
      <>
        {braid.map((p) => (
          <path
            key={p.strand.nodeId}
            d={p.d}
            fill="none"
            data-strand-node={p.strand.nodeId}
            data-strand-separated={p.separated ? 'true' : 'false'}
            strokeDasharray={p.separated || selected ? undefined : dashArray}
            className={p.separated || selected ? undefined : 'tether-march'}
            style={{
              stroke: p.separated ? 'var(--color-accent)' : p.strand.colorVar,
              strokeWidth: strandWidth,
              ['--march-shift' as string]: String(DASH_SUM),
            }}
          />
        ))}
        {braid.map((p) =>
          p.separated && p.apex ? (
            <circle
              key={`apex-${p.strand.nodeId}`}
              cx={p.apex.x}
              cy={p.apex.y}
              r={APEX_DOT_RADIUS}
              fill="var(--color-accent)"
              data-strand-apex={p.strand.nodeId}
            />
          ) : null,
        )}
        {/* Shared cable-end dots (all strands merge here). */}
        <circle cx={sourceX} cy={sourceY} r={DOT_RADIUS} fill="var(--color-accent)" />
        <circle cx={targetX} cy={targetY} r={DOT_RADIUS} fill="var(--color-accent)" />
      </>
    );
  }

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
