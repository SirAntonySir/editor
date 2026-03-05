export interface CurvePoint {
  x: number; // 0..1
  y: number; // 0..1
}

export function evaluateCubicSpline(points: CurvePoint[]): Float32Array {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const n = sorted.length;
  const lut = new Float32Array(256);

  if (n < 2) {
    // Identity
    for (let i = 0; i < 256; i++) lut[i] = i / 255;
    return lut;
  }

  // Monotone cubic interpolation (Fritsch-Carlson)
  const xs = sorted.map((p) => p.x);
  const ys = sorted.map((p) => p.y);
  const deltas: number[] = [];
  const m: number[] = new Array(n).fill(0);

  for (let i = 0; i < n - 1; i++) {
    deltas.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-6));
  }

  m[0] = deltas[0];
  m[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (deltas[i - 1] + deltas[i]) / 2;
    }
  }

  // Ensure monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(deltas[i]) < 1e-6) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / deltas[i];
      const beta = m[i + 1] / deltas[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * alpha * deltas[i];
        m[i + 1] = tau * beta * deltas[i];
      }
    }
  }

  for (let i = 0; i < 256; i++) {
    const x = i / 255;

    // Find segment
    let seg = n - 2;
    for (let j = 0; j < n - 1; j++) {
      if (x <= xs[j + 1]) {
        seg = j;
        break;
      }
    }

    const h = xs[seg + 1] - xs[seg] || 1e-6;
    const t = (x - xs[seg]) / h;
    const t2 = t * t;
    const t3 = t2 * t;

    // Hermite basis
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    lut[i] = Math.max(0, Math.min(1, h00 * ys[seg] + h10 * h * m[seg] + h01 * ys[seg + 1] + h11 * h * m[seg + 1]));
  }

  return lut;
}

export const DEFAULT_CURVE_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
