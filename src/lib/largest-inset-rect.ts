/** Compute the largest axis-aligned rectangle of a given aspect ratio that
 *  fits inside a `W × H` source rectangle rotated by `angleDeg` (any angle,
 *  positive or negative). The result is centered in the source frame; the
 *  caller is responsible for positioning it.
 *
 *  Math:
 *    Let θ = |angleDeg| in radians, c = cos θ, s = sin θ.
 *    A rect with dims w × h, when rotated by θ, has bounding-box dims
 *      (w·c + h·s) × (w·s + h·c).
 *    For the rect to fit inside W × H we need:
 *      w·c + h·s ≤ W
 *      w·s + h·c ≤ H
 *    Given the aspect ratio constraint `w = h · ratio`, substitute and solve
 *    for h, taking the minimum (the binding constraint).
 */
export function largestInsetRect(
  W: number,
  H: number,
  angleDeg: number,
  aspectRatio: number,
): { w: number; h: number } {
  const θ = Math.abs(angleDeg) * Math.PI / 180;
  const c = Math.cos(θ);
  const s = Math.sin(θ);
  // From w = h·ratio:
  //   h·ratio·c + h·s ≤ W  →  h ≤ W / (ratio·c + s)
  //   h·ratio·s + h·c ≤ H  →  h ≤ H / (ratio·s + c)
  const denomW = aspectRatio * c + s;
  const denomH = aspectRatio * s + c;
  if (denomW === 0 || denomH === 0) {
    return { w: 0, h: 0 };
  }
  const hByW = W / denomW;
  const hByH = H / denomH;
  const h = Math.min(hByW, hByH);
  const w = h * aspectRatio;
  return { w, h };
}
