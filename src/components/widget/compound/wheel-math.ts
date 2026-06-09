/** Default palette used when an anchor doesn't declare its own color. */
export const AUTO_PALETTE = [
  '#22c55e',  // green
  '#eab308',  // yellow
  '#ea580c',  // orange
  '#3b82f6',  // blue
  '#a855f7',  // purple
  '#ec4899',  // pink
] as const;

export interface AnchorLike {
  position?: number;
  name: string;
  color?: string | null;
}

/** Even-spaced anchor angles starting at 0° (top), going clockwise. */
export function anchorAngles(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i * 360) / n);
  return out;
}

/** Normalize a value into [0, 1) via modulo (wrap). */
function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}

/** Position → indicator angle (degrees, returned in [0, 360)).
 *
 *  Anchors are evenly spaced around the wheel in *angle* space (angle[i] = i/N * 360)
 *  but typically irregular in *position* space. Each segment between consecutive
 *  anchors covers a fixed 360/N angle slice, regardless of how wide its position span is.
 *
 *  - Exact anchor position matches return angles[i] directly.
 *  - The cyclic seam segment connects anchors[last] → anchors[0]+1 (extended position
 *    space), mapping to angles[last] → angles[0]+360. Positions below positions[0] are
 *    treated as cyclically wrapped (t + 1) for this segment.
 *  - Other positions land in a normal segment positions[i] ≤ t < positions[i+1] and
 *    interpolate linearly between angles[i] and angles[i+1].
 *
 *  Out-of-range positions are wrapped via wrap01 before processing.
 */
export function positionToIndicatorAngle(
  anchors: AnchorLike[],
  position: number,
): number {
  if (anchors.length < 2) return 0;

  // Wrap to [0, 1) then restore the 1.0 case (exact last-anchor match).
  const t = wrap01(position);
  const isExact1 = Number.isFinite(position) && Math.abs(position - Math.round(position)) < 1e-12 && position > 0;

  const n = anchors.length;
  const angles = anchorAngles(n);
  const positions = anchors.map(a => a.position ?? 0);
  const last = positions.length - 1;

  const tForMatch = isExact1 ? 1.0 : t;

  // 1. Exact anchor match takes priority (handles 0.0 and 1.0 cleanly).
  for (let i = 0; i < positions.length; i++) {
    if (Math.abs(tForMatch - positions[i]) < 1e-9) return angles[i];
  }

  // 2. Cyclic seam: positions in (positions[last], positions[0]+1) extended space.
  //    Positions below positions[0] are shifted by +1 to land in this interval.
  const seamStartPos = positions[last];
  const seamEndPos   = positions[0] + 1;
  const tExt = t < positions[0] ? t + 1 : t;
  if (tExt > seamStartPos && tExt < seamEndPos) {
    const frac = (tExt - seamStartPos) / (seamEndPos - seamStartPos);
    const startAngle = angles[last];
    const endAngle   = angles[0] + 360;
    return ((startAngle + frac * (endAngle - startAngle)) % 360 + 360) % 360;
  }

  // 3. Normal segment: find (i, i+1) pair that straddles t and interpolate.
  for (let i = 0; i < last; i++) {
    if (positions[i] <= t && t < positions[i + 1]) {
      const frac = (t - positions[i]) / (positions[i + 1] - positions[i]);
      return angles[i] + frac * (angles[i + 1] - angles[i]);
    }
  }

  // Fallback (should not be reached for well-formed anchor lists).
  return angles[last];
}

/** Inverse: indicator angle → position. Mirror of `positionToIndicatorAngle`.
 *
 *  - Exact anchor angle matches return positions[i] directly.
 *  - Angles in [angles[last], angles[0]+360) (the cyclic seam slice) map to
 *    positions[last] + frac * (positions[0]+1 - positions[last]), wrapped to [0,1].
 *  - Other angles land in a normal slice and map through anchor position values.
 *
 *  Always returns a value in [0, 1].
 */
export function angleToPosition(
  anchors: AnchorLike[],
  angleDeg: number,
): number {
  if (anchors.length < 2) return 0;

  const a = ((angleDeg % 360) + 360) % 360;
  const n = anchors.length;
  const angles = anchorAngles(n);
  const positions = anchors.map(x => x.position ?? 0);
  const last = positions.length - 1;

  // 1. Exact anchor angle match.
  for (let i = 0; i < angles.length; i++) {
    if (Math.abs(a - angles[i]) < 1e-9) return positions[i];
  }

  // 2. Cyclic seam slice in angle space: [angles[last], angles[0]+360).
  //    Angles below angles[0] are shifted by +360 to land in this interval.
  const startAngle = angles[last];
  const endAngle   = angles[0] + 360;
  const aExt = a < angles[0] ? a + 360 : a;
  if (aExt > startAngle && aExt < endAngle) {
    const frac = (aExt - startAngle) / (endAngle - startAngle);
    const rawPos = positions[last] + frac * ((positions[0] + 1) - positions[last]);
    if (rawPos >= 1 - 1e-9 && rawPos <= 1 + 1e-9) return 1;
    return wrap01(rawPos);
  }

  // 3. Normal slice.
  for (let i = 0; i < last; i++) {
    if (angles[i] <= a && a < angles[i + 1]) {
      const frac = (a - angles[i]) / (angles[i + 1] - angles[i]);
      return positions[i] + frac * (positions[i + 1] - positions[i]);
    }
  }
  return positions[last];
}

/** Wedge index whose angular slice contains the given indicator angle.
 *  Wedge i is centered at angles[i] = i * 360/N and spans
 *  [angles[i] - 360/(2N), angles[i] + 360/(2N)) on the wheel. Wedge 0 wraps
 *  across the seam. Returns -1 when there are no anchors. */
export function activeWedgeIndexFromAngle(n: number, indicatorAngleDeg: number): number {
  if (n <= 0) return -1;
  const wedgeSpan = 360 / n;
  const a = ((indicatorAngleDeg % 360) + 360) % 360;
  const shifted = (a + wedgeSpan / 2) % 360;
  return Math.floor(shifted / wedgeSpan) % n;
}

/** Resolve a wedge color: anchor.color if set, else cycle through `palette`. */
export function resolveWedgeColor(
  anchor: AnchorLike,
  index: number,
  palette: readonly string[],
): string {
  if (anchor.color) return anchor.color;
  return palette[index % palette.length];
}
