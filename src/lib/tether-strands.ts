import { Position } from '@xyflow/react';
import type { Widget } from '@/types/widget';
import { loadRegistry } from '@/lib/registry/loader';

/**
 * Braided-tether geometry + strand derivation (Phase B of fused-intent-widgets).
 *
 * A fused widget's tether renders as N thin strands — one per op node — woven
 * around the base Bézier and merging at both endpoints. Category tint tokens
 * live in src/index.css (`--strand-<category>`); this module is the single
 * source of the category→token mapping so the section swatches (card) and the
 * strand strokes (canvas) can never drift.
 */

// ── Category → tint token ────────────────────────────────────────────────
// Values mirror the op `category` field in shared/registry/schema.ts
// (tone, color, detail, texture, effect). Anything else → the neutral default.
const STRAND_TOKEN_BY_CATEGORY: Record<string, string> = {
  tone: '--strand-tone',
  color: '--strand-color',
  detail: '--strand-detail',
  texture: '--strand-texture',
  effect: '--strand-effect',
};

/** Raw CSS custom-property name for a category (falls back to the neutral). */
export function strandTokenForCategory(category: string | null | undefined): string {
  return (category && STRAND_TOKEN_BY_CATEGORY[category]) || '--strand-default';
}

/** `var(--strand-…)` wrapper, ready to drop into a `stroke` / `background`. */
export function strandColorVarForCategory(category: string | null | undefined): string {
  return `var(${strandTokenForCategory(category)})`;
}

// ── Strand derivation ────────────────────────────────────────────────────
export interface TetherStrand {
  /** The widget op-graph node this strand represents (node-keyed, like slices). */
  nodeId: string;
  /** The registry op id (may be absent on legacy nodes → resolved by node type). */
  opId: string;
  /** `var(--strand-<category>)` for this node's op category. */
  colorVar: string;
  /** True when ≥1 of this node's bound params is currently pinned. */
  separated: boolean;
}

/**
 * Compute the braid strands for a fused widget: one per op node. Non-fused
 * widgets (no `compound`) return an empty array → the tether stays a single
 * path. `separated` is true when any of a node's binding paramKeys is in
 * `widget.lockedParams`.
 */
export function deriveStrands(widget: Widget): TetherStrand[] {
  if (!widget.compound) return [];
  const reg = loadRegistry();
  const locked = new Set(widget.lockedParams ?? []);
  const strands: TetherStrand[] = [];
  for (const node of widget.nodes) {
    // Resolve category the same way sliceWidgetByOp resolves the op: prefer
    // opId, fall back to matching the engine node_type.
    let op = node.opId ? reg.ops[node.opId] : undefined;
    if (!op) op = Object.values(reg.ops).find((o) => o.engine.node_type === node.type);
    const category = op?.category ?? null;
    const bindings = widget.bindings.filter((b) => b.target?.nodeId === node.id);
    const separated = bindings.some(
      (b) => locked.has(b.target.paramKey) || locked.has(b.paramKey),
    );
    strands.push({
      nodeId: node.id,
      opId: node.opId ?? op?.id ?? node.type,
      colorVar: strandColorVarForCategory(category),
      separated,
    });
  }
  return strands;
}

// ── Bézier sampling (analytic; unit-testable) ────────────────────────────
export interface Pt {
  x: number;
  y: number;
}

/** RF's control-offset curve (mirrors @xyflow/system calculateControlOffset). */
function controlOffset(distance: number, curvature: number): number {
  if (distance >= 0) return 0.5 * distance;
  return curvature * 25 * Math.sqrt(-distance);
}

/** RF's per-endpoint control point (mirrors getControlWithCurvature). */
function controlPoint(pos: Position, x1: number, y1: number, x2: number, y2: number, c: number): Pt {
  switch (pos) {
    case Position.Left:
      return { x: x1 - controlOffset(x1 - x2, c), y: y1 };
    case Position.Right:
      return { x: x1 + controlOffset(x2 - x1, c), y: y1 };
    case Position.Top:
      return { x: x1, y: y1 - controlOffset(y1 - y2, c) };
    case Position.Bottom:
    default:
      return { x: x1, y: y1 + controlOffset(y2 - y1, c) };
  }
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * Sample the same cubic Bézier that `getBezierPath` draws, at N+1 evenly-spaced
 * points (s = 0…1 inclusive). Control points are computed exactly as React Flow
 * does, so the braid rides the real tether curve. First/last points equal the
 * source/target endpoints exactly.
 */
export function sampleBezier(
  source: Pt,
  target: Pt,
  positions: { source: Position; target: Position },
  curvature: number,
  n: number,
): Pt[] {
  const c0 = source;
  const c1 = controlPoint(positions.source, source.x, source.y, target.x, target.y, curvature);
  const c2 = controlPoint(positions.target, target.x, target.y, source.x, source.y, curvature);
  const c3 = target;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    pts.push(cubicAt(c0, c1, c2, c3, i / n));
  }
  return pts;
}

/** Per-point unit normals (perpendicular to the local tangent). Endpoints reuse
 *  their neighbour's tangent so the normal is always defined. */
export function unitNormals(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Rotate tangent 90°: normal = (-ty, tx).
    out.push({ x: -ty, y: tx });
  }
  return out;
}

// Braid tuning constants (canvas units).
export const BRAID_AMPLITUDE = 7; // A — perpendicular weave amplitude
export const BRAID_FREQUENCY = 2.2; // F — weave cycles along the cable
export const LIFT_AMPLITUDE = 18; // L — separated-strand lift-out height
export const BRAID_SAMPLES = 48; // N — sample count along the curve

/**
 * Perpendicular offset for a braided strand at parametric position s∈[0,1].
 * `A · sin(π·s) · sin(2πF·s + φ)` — the sin(π·s) envelope forces the offset to
 * zero at both endpoints, so all strands merge into the shared cable ends.
 */
export function braidOffset(s: number, phase: number, amplitude = BRAID_AMPLITUDE, frequency = BRAID_FREQUENCY): number {
  return amplitude * Math.sin(Math.PI * s) * Math.sin(2 * Math.PI * frequency * s + phase);
}

/**
 * Lift envelope for a separated strand: `L · sin(π·s)` — a single hump that
 * peaks at s=0.5 and merges at both endpoints. Sign is chosen by the caller
 * (always lifted to one side, away from the braid).
 */
export function liftOffset(s: number, amplitude = LIFT_AMPLITUDE): number {
  return amplitude * Math.sin(Math.PI * s);
}

/** Build an SVG polyline `d` string by offsetting each base point along its
 *  normal by `offsetFn(s)`. */
export function buildStrandPath(base: Pt[], normals: Pt[], offsetFn: (s: number) => number): string {
  const last = base.length - 1;
  let d = '';
  for (let i = 0; i <= last; i++) {
    const s = i / last;
    const o = offsetFn(s);
    const x = base[i].x + normals[i].x * o;
    const y = base[i].y + normals[i].y * o;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return d;
}

/** Apex point (s=0.5) of a strand's offset curve — used for the separated dot. */
export function strandApex(base: Pt[], normals: Pt[], offsetFn: (s: number) => number): Pt {
  const mid = Math.round((base.length - 1) / 2);
  const s = mid / (base.length - 1);
  const o = offsetFn(s);
  return { x: base[mid].x + normals[mid].x * o, y: base[mid].y + normals[mid].y * o };
}
