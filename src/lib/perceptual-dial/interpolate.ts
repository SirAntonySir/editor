import type { Anchor, CompoundParams } from './types';

/**
 * 1-D Catmull-Rom interpolation across `anchors` at scalar `t` in [0, 1].
 * Anchors are sorted internally by `position[0]`; ties keep first-seen order.
 * If `t` falls outside the anchor range, returns the nearest endpoint's params verbatim.
 * Missing keys on either neighbour default to 0 (so partial anchors interpolate towards 0).
 */
export function interpolate1D(anchors: Anchor[], t: number): CompoundParams {
  if (anchors.length === 0) return {};
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  if (t <= sorted[0].position[0]) return { ...sorted[0].params };
  if (t >= sorted[sorted.length - 1].position[0]) return { ...sorted[sorted.length - 1].params };

  // Find the segment [p1, p2] containing t.
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].position[0] < t) i += 1;
  const p0 = sorted[Math.max(i - 1, 0)];
  const p1 = sorted[i];
  const p2 = sorted[i + 1];
  const p3 = sorted[Math.min(i + 2, sorted.length - 1)];

  const span = p2.position[0] - p1.position[0];
  const u = span > 0 ? (t - p1.position[0]) / span : 0;

  // Collect the union of keys present across the four control anchors.
  const keys = new Set<string>([
    ...Object.keys(p0.params),
    ...Object.keys(p1.params),
    ...Object.keys(p2.params),
    ...Object.keys(p3.params),
  ]);

  const out: CompoundParams = {};
  for (const k of keys) {
    const v0 = p0.params[k] ?? 0;
    const v1 = p1.params[k] ?? 0;
    const v2 = p2.params[k] ?? 0;
    const v3 = p3.params[k] ?? 0;
    out[k] = catmullRom(v0, v1, v2, v3, u);
  }
  return out;
}

/** Centripetal-style Catmull-Rom scalar interpolation; tension 0.5 (standard). */
function catmullRom(v0: number, v1: number, v2: number, v3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    (2 * v1) +
    (-v0 + v2) * u +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
    (-v0 + 3 * v1 - 3 * v2 + v3) * u3
  );
}
