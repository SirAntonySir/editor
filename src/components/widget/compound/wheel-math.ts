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
 *  Design:
 *  - Anchors are evenly spaced around the wheel in *angle* space: angle[i] = i/N * 360.
 *  - The cyclic seam segment connects anchors[last] → anchors[0] (crossing the 1.0/0.0
 *    boundary). The seam is given even width 1/N in position space, symmetric around the
 *    0/1 boundary: it covers [1 - 1/(2N), 1] ∪ [0, 1/(2N)) in normalised position space.
 *  - Exact anchor position matches (t === positions[i]) always return angles[i] directly.
 *  - For positions inside the seam (but not exact anchor matches), linear interpolation
 *    runs from angles[last]=270° to angles[0]+360=360°.
 *  - For all other positions, the function finds the straddling (i, i+1) pair and
 *    linearly interpolates between angles[i] and angles[i+1] using the actual position
 *    values declared on the anchors.
 *
 *  Cyclic wrap: out-of-range values are wrapped via wrap01 before processing.
 */
export function positionToIndicatorAngle(
  anchors: AnchorLike[],
  position: number,
): number {
  if (anchors.length < 2) return 0;

  // Wrap to [0, 1) then restore the 1.0 case (exact last-anchor match).
  let t = wrap01(position);
  // Special-case: position was exactly 1.0 (or any integer multiple).
  // wrap01(1.0) = 0.0, but we want 1.0 to match positions[last] if it equals 1.0.
  const isExact1 = Number.isFinite(position) && Math.abs(position - Math.round(position)) < 1e-12 && position > 0;

  const n = anchors.length;
  const angles = anchorAngles(n);
  const positions = anchors.map(a => a.position ?? 0);
  const last = positions.length - 1;

  // Restore 1.0 if the original position was an exact positive integer (maps to last anchor).
  const tForMatch = isExact1 ? 1.0 : t;

  // 1. Exact anchor match takes priority (handles both 0.0 and 1.0 cleanly).
  for (let i = 0; i < positions.length; i++) {
    if (Math.abs(tForMatch - positions[i]) < 1e-9) return angles[i];
  }

  // 2. Cyclic seam: even-width segment of 1/N, centered on the 0/1 boundary.
  //    Covers [0, 1/(2N)) ∪ [1 - 1/(2N), 1) in [0,1) space.
  const halfStep = 1 / (2 * n);
  if (t < halfStep || t >= 1 - halfStep) {
    const startPos   = 1 - halfStep;            // seam start in [0,1) space
    const endPos     = halfStep;                 // seam end (past the wrap)
    const startAngle = angles[last];             // e.g. 270° for N=4
    const endAngle   = angles[0] + 360;          // e.g. 360° for N=4

    // Map t into [startPos, startPos + 1/N) by shifting values < halfStep up by 1.
    const tShifted = t < halfStep ? t + 1 : t;
    const frac = (tShifted - startPos) / (1 / n);

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

/** Inverse: indicator angle → position.
 *
 *  Mirror of positionToIndicatorAngle:
 *  - Exact anchor angle matches return positions[i] directly.
 *  - Seam segment (even 1/N width around 0°/360°) maps back via linear interpolation.
 *  - Normal angle segments map back through the actual position values.
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

  // 2. Seam segment: even 1/N width in angle space around 0°/360°.
  //    Covers [360 - 180/N, 360) ∪ [0, 180/N) in normalised angle space.
  const halfAngleStep = 360 / (2 * n);  // = 180/N
  if (a < halfAngleStep || a >= 360 - halfAngleStep) {
    const startAngle = angles[last];       // e.g. 270° for N=4
    const endAngle   = angles[0] + 360;   // e.g. 360° for N=4

    const aShifted = a < halfAngleStep ? a + 360 : a;
    const frac = (aShifted - startAngle) / (360 / n);

    const rawPos = positions[last] + frac * ((positions[0] + 1) - positions[last]);
    // Wrap back to [0, 1]: exact 1.0 is valid (last anchor), values > 1.0 wrap to [0,1).
    if (rawPos >= 1 - 1e-9 && rawPos <= 1 + 1e-9) return 1;
    return wrap01(rawPos);
  }

  // 3. Normal segment.
  for (let i = 0; i < last; i++) {
    if (angles[i] <= a && a < angles[i + 1]) {
      const frac = (a - angles[i]) / (angles[i + 1] - angles[i]);
      return positions[i] + frac * (positions[i + 1] - positions[i]);
    }
  }
  return positions[last];
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
