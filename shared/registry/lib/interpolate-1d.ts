import type { CompoundAnchor } from '../schema';

/** Centripetal Catmull-Rom 1D, tension 0.5. */
function catmullRom(v0: number, v1: number, v2: number, v3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    2 * v1 +
    (-v0 + v2) * u +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
    (-v0 + 3 * v1 - 3 * v2 + v3) * u3
  );
}

/** Interpolate the derived values at position `t` along an anchor table.
 *  Anchors must be sorted by position. Returns a fresh dict.
 *  Out-of-range `t` clamps to the nearest endpoint's values verbatim.
 *  Missing keys on a neighbour default to 0. */
export function interpolate1D(
  anchors: CompoundAnchor[],
  t: number,
): Record<string, number> {
  if (anchors.length < 2) throw new Error('need at least 2 anchors');
  if (t <= anchors[0].position) return { ...anchors[0].values };
  const last = anchors[anchors.length - 1];
  if (t >= last.position) return { ...last.values };

  let i = 0;
  while (i < anchors.length - 1 && anchors[i + 1].position < t) i++;
  const p0 = anchors[Math.max(i - 1, 0)];
  const p1 = anchors[i];
  const p2 = anchors[i + 1];
  const p3 = anchors[Math.min(i + 2, anchors.length - 1)];

  const span = p2.position - p1.position;
  const u = span > 0 ? (t - p1.position) / span : 0;

  const keys = new Set<string>([
    ...Object.keys(p0.values),
    ...Object.keys(p1.values),
    ...Object.keys(p2.values),
    ...Object.keys(p3.values),
  ]);
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = catmullRom(
      p0.values[k] ?? 0,
      p1.values[k] ?? 0,
      p2.values[k] ?? 0,
      p3.values[k] ?? 0,
      u,
    );
  }
  return out;
}
