import { describe, it, expect } from 'vitest';
import { Position, getBezierPath } from '@xyflow/react';
import type { Widget } from '@/types/widget';
import {
  deriveStrands,
  strandTokenForCategory,
  strandColorVarForCategory,
  sampleBezier,
  braidOffset,
  liftOffset,
  buildStrandPath,
  unitNormals,
  BRAID_SAMPLES,
} from './tether-strands';

// A fused widget with two op nodes (light → tone, color → color). Uses real
// registry op ids so category resolution goes through loadRegistry().
function fusedWidget(opts: { lockedParams?: string[]; compound?: boolean } = {}): Widget {
  return {
    id: 'w_1',
    intent: 'warmer + brighter',
    scope: { root: { kind: 'global' } },
    origin: { kind: 'mcp_user_prompt' },
    composed: true,
    status: 'active',
    revision: 1,
    lockedParams: opts.lockedParams ?? [],
    preview: { kind: 'none', autoBeforeAfter: false },
    compound: opts.compound === false ? null : { label: 'Intensity', anchors: [] },
    nodes: [
      { id: 'n_light', type: 'basic', opId: 'light', params: {}, scope: { root: { kind: 'global' } }, inputs: [], widgetId: 'w_1', layerId: 'L1' },
      { id: 'n_color', type: 'color', opId: 'color', params: {}, scope: { root: { kind: 'global' } }, inputs: [], widgetId: 'w_1', layerId: 'L1' },
    ],
    bindings: [
      { paramKey: 'exposure', label: 'Exposure', controlType: 'slider', controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 }, value: 20, default: 0, target: { nodeId: 'n_light', paramKey: 'exposure' } },
      { paramKey: 'saturation', label: 'Saturation', controlType: 'slider', controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 }, value: 15, default: 0, target: { nodeId: 'n_color', paramKey: 'saturation' } },
    ],
  } as unknown as Widget;
}

describe('category → token mapping', () => {
  it('maps known categories to their strand tokens', () => {
    expect(strandTokenForCategory('tone')).toBe('--strand-tone');
    expect(strandTokenForCategory('color')).toBe('--strand-color');
    expect(strandTokenForCategory('detail')).toBe('--strand-detail');
    expect(strandTokenForCategory('texture')).toBe('--strand-texture');
    expect(strandTokenForCategory('effect')).toBe('--strand-effect');
  });

  it('falls back to the neutral default token for unknown / missing categories', () => {
    expect(strandTokenForCategory('bogus')).toBe('--strand-default');
    expect(strandTokenForCategory(null)).toBe('--strand-default');
    expect(strandTokenForCategory(undefined)).toBe('--strand-default');
  });

  it('wraps the token in var(...)', () => {
    expect(strandColorVarForCategory('tone')).toBe('var(--strand-tone)');
    expect(strandColorVarForCategory(undefined)).toBe('var(--strand-default)');
  });
});

describe('deriveStrands', () => {
  it('produces one strand per op node with the correct category token', () => {
    const strands = deriveStrands(fusedWidget());
    expect(strands).toHaveLength(2);
    expect(strands[0]).toMatchObject({ nodeId: 'n_light', colorVar: 'var(--strand-tone)', separated: false });
    expect(strands[1]).toMatchObject({ nodeId: 'n_color', colorVar: 'var(--strand-color)', separated: false });
  });

  it('marks a strand separated when one of its params is pinned', () => {
    const strands = deriveStrands(fusedWidget({ lockedParams: ['saturation'] }));
    expect(strands.find((s) => s.nodeId === 'n_color')?.separated).toBe(true);
    expect(strands.find((s) => s.nodeId === 'n_light')?.separated).toBe(false);
  });

  it('returns no strands for a non-fused widget (no compound)', () => {
    expect(deriveStrands(fusedWidget({ compound: false }))).toEqual([]);
  });

  it('uses the default token for a node whose op has no category (unknown opId → node_type fallback fails)', () => {
    const w = fusedWidget();
    // Point one node at an opId that does not exist and a type with no matching op.
    (w.nodes[0] as { opId: string; type: string }).opId = 'does-not-exist';
    (w.nodes[0] as { opId: string; type: string }).type = 'no-such-type';
    const strands = deriveStrands(w);
    expect(strands[0].colorVar).toBe('var(--strand-default)');
  });
});

describe('sampleBezier', () => {
  const src = { x: 0, y: 0 };
  const tgt = { x: 100, y: 60 };
  const positions = { source: Position.Right, target: Position.Left };

  it('returns N+1 points', () => {
    expect(sampleBezier(src, tgt, positions, 0.3, BRAID_SAMPLES)).toHaveLength(BRAID_SAMPLES + 1);
  });

  it('first/last points equal source/target exactly', () => {
    const pts = sampleBezier(src, tgt, positions, 0.3, BRAID_SAMPLES);
    expect(pts[0]).toEqual(src);
    expect(pts[pts.length - 1]).toEqual(tgt);
  });

  // Regression guard: our analytic control points must match React Flow's
  // getBezierPath, or the braid visibly detaches from where RF routes the
  // single-path tether. Parse RF's `M sx,sy C c1x,c1y c2x,c2y tx,ty` output,
  // evaluate the cubic at interior t, and compare against sampleBezier —
  // for BOTH a horizontal and a vertical handle pair. Catches upstream drift
  // in @xyflow's curvature math.
  it.each([
    { source: Position.Right, target: Position.Left },
    { source: Position.Bottom, target: Position.Top },
  ])('interior samples match getBezierPath controls ($source→$target)', (pos) => {
    const [pathStr] = getBezierPath({
      sourceX: src.x, sourceY: src.y, targetX: tgt.x, targetY: tgt.y,
      sourcePosition: pos.source, targetPosition: pos.target,
      curvature: 0.3,
    });
    const nums = pathStr.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // M sx sy C c1x c1y c2x c2y tx ty
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = nums;
    const cubic = (a: number, b: number, c: number, d: number, t: number) => {
      const u = 1 - t;
      return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
    };
    const N = 8;
    const pts = sampleBezier(src, tgt, pos, 0.3, N);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      expect(pts[i].x).toBeCloseTo(cubic(sx, c1x, c2x, tx, t), 6);
      expect(pts[i].y).toBeCloseTo(cubic(sy, c1y, c2y, ty, t), 6);
    }
  });
});

describe('braid + lift envelopes', () => {
  it('braid offset is zero at both endpoints (merge)', () => {
    expect(braidOffset(0, 0)).toBeCloseTo(0, 10);
    expect(braidOffset(1, 0)).toBeCloseTo(0, 10);
    // A non-endpoint sample is non-zero for a non-degenerate phase.
    expect(Math.abs(braidOffset(0.37, Math.PI / 3))).toBeGreaterThan(0);
  });

  it('lift offset is zero at endpoints and peaks at the midpoint', () => {
    expect(liftOffset(0)).toBeCloseTo(0, 10);
    expect(liftOffset(1)).toBeCloseTo(0, 10);
    expect(liftOffset(0.5)).toBeGreaterThan(liftOffset(0.25));
  });
});

describe('buildStrandPath', () => {
  it('produces a polyline starting with M and containing L segments', () => {
    const base = sampleBezier({ x: 0, y: 0 }, { x: 40, y: 0 }, { source: Position.Right, target: Position.Left }, 0.3, 8);
    const normals = unitNormals(base);
    const d = buildStrandPath(base, normals, (s) => braidOffset(s, 0));
    expect(d.startsWith('M')).toBe(true);
    expect((d.match(/L/g) ?? []).length).toBe(8);
  });
});
