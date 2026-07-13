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

/**
 * Piecewise-linear interpolation across `anchors` at scalar `t` — mirrors
 * backend `interpolate_linear_1d`. Out-of-range `t` clamps to nearest endpoint.
 * Missing keys on a neighbour default to 0.
 */
export function interpolateLinear1D(anchors: Anchor[], t: number): CompoundParams {
  if (anchors.length === 0) return {};
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  if (t <= sorted[0].position[0]) return { ...sorted[0].params };
  if (t >= sorted[sorted.length - 1].position[0]) return { ...sorted[sorted.length - 1].params };

  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].position[0] < t) i += 1;
  const p1 = sorted[i];
  const p2 = sorted[i + 1];

  const span = p2.position[0] - p1.position[0];
  const u = span > 0 ? (t - p1.position[0]) / span : 0;

  const keys = new Set<string>([...Object.keys(p1.params), ...Object.keys(p2.params)]);
  const out: CompoundParams = {};
  for (const k of keys) {
    const v1 = p1.params[k] ?? 0;
    const v2 = p2.params[k] ?? 0;
    out[k] = v1 + u * (v2 - v1);
  }
  return out;
}

/**
 * `interpolate1D` / `interpolateLinear1D` plus linear extrapolation past the
 * LAST anchor — mirrors backend `interpolate_extended`.
 *
 * `mode` selects in-range interpolation:
 * - `'catmull_rom_1d'` (default) — Catmull-Rom (back-compat for 2-anchor tables)
 * - `'linear_1d'` — piecewise-linear (3-anchor fused compounds)
 *
 * Extrapolation past the last anchor is always linear. Per-param range clamping
 * is the caller's job.
 */
export function interpolateExtended(
  anchors: Anchor[],
  t: number,
  mode: 'catmull_rom_1d' | 'linear_1d' = 'catmull_rom_1d',
): CompoundParams {
  if (anchors.length < 2) return interpolate1D(anchors, t);
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  const last = sorted[sorted.length - 1];
  if (t <= last.position[0]) {
    return mode === 'linear_1d' ? interpolateLinear1D(anchors, t) : interpolate1D(anchors, t);
  }

  const prev = sorted[sorted.length - 2];
  const span = last.position[0] - prev.position[0];
  if (span <= 0) return { ...last.params };
  const keys = new Set<string>([...Object.keys(prev.params), ...Object.keys(last.params)]);
  const overshoot = t - last.position[0];
  const out: CompoundParams = {};
  for (const k of keys) {
    const lv = last.params[k] ?? 0;
    const pv = prev.params[k] ?? 0;
    out[k] = lv + ((lv - pv) / span) * overshoot;
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
