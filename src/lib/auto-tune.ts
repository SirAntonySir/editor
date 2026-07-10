/**
 * Mechanical auto-tune presets.
 *
 * Pure functions over the live `MechanicalSnapshot`. Each helper returns a
 * `{ opId, params, intent }` triple ready to feed `spawnRegistryOp(...)`.
 * No LLM call — just the same statistics we already surface in the Info
 * tab's Histograms + Color sections.
 *
 * Formulas are deliberately conservative — Auto should look like a gentle
 * baseline, not an opinionated grade. Users layer their own intent on top.
 */

import type { MechanicalSnapshot } from '@/lib/mechanical-context';

export interface AutoSpawnSpec {
  opId: string;
  params: Record<string, number>;
  intent: string;
}

/** Clamp helper. */
function _clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Auto Light — exposure toward median-luma 128, optional contrast lift when
 *  the histogram is flat. Maps to `light` op params in [-100, 100]. */
export function autoLight(m: MechanicalSnapshot): AutoSpawnSpec {
  // medianLuma is in [0, 255]. Target a perceptually mid value of 128.
  // Scale the gap by ~0.6 so we nudge rather than slam — the user can push
  // further with the slider.
  const exposureDelta = _clamp(((128 - m.medianLuma) / 128) * 60, -50, 50);
  // Lift contrast when the histogram is compressed (p10-p90 < ~140).
  const contrastDelta = _clamp((140 - m.contrastP10P90) * 0.4, -20, 30);
  return {
    opId: 'light',
    params: {
      exposure: Math.round(exposureDelta),
      contrast: Math.round(contrastDelta),
    },
    intent: 'Auto light',
  };
}

/** Auto Contrast — only contrast, target a wider p10-p90 spread. */
export function autoContrast(m: MechanicalSnapshot): AutoSpawnSpec {
  const contrastDelta = _clamp((160 - m.contrastP10P90) * 0.5, -30, 50);
  return {
    opId: 'light',
    params: { contrast: Math.round(contrastDelta) },
    intent: 'Auto contrast',
  };
}

/** Auto Tone — recover clipped highlights, lift crushed shadows. */
export function autoTone(m: MechanicalSnapshot): AutoSpawnSpec {
  // Convert clipped percentages (0-100) into highlight/shadow nudges.
  // 1% highlight clipping ≈ -8 highlights; shadow lift is intentionally gentle
  // at ~0.8/1% (crushed-shadow recovery was too aggressive), both capped at ±50.
  const highlights = m.clippedHighlightsPct > 0.5
    ? _clamp(-m.clippedHighlightsPct * 8, -50, 0)
    : 0;
  const shadows = m.clippedShadowsPct > 0.5
    ? _clamp(m.clippedShadowsPct * 0.8, 0, 50)
    : 0;
  return {
    opId: 'light',
    params: {
      highlights: Math.round(highlights),
      shadows: Math.round(shadows),
    },
    intent: 'Auto tone',
  };
}

/** Auto Color — neutralise a chromatic cast via white balance.
 *  castDirection is Lab a-star / b-star of the mean RGB. Positive a-star =
 *  red cast → cool the image (lower kelvin). Negative b-star = blue cast →
 *  warm (raise kelvin). Coarse single-knob correction; real cast correction
 *  needs per-channel curves. Good enough as a first pass. */
export function autoColor(m: MechanicalSnapshot): AutoSpawnSpec {
  // Defensive default: a malformed snapshot (or partial mock) may omit
  // castDirection. Treat absent as "no cast detected".
  const [a, b] = m.castDirection ?? [0, 0];
  // Kelvin is in [2000, 10000], neutral 6500. Warm = higher k, cool = lower.
  // Use b* (yellow/blue axis) as the primary signal: positive b* (yellow
  // cast) → cool toward lower kelvin. a* (red/green) is secondary; we
  // fold a small fraction into the same kelvin shift.
  const shift = _clamp(-b * 30 - a * 15, -2000, 2000);
  const kelvin = Math.round(_clamp(6500 + shift, 2000, 10000));
  return {
    opId: 'kelvin',
    params: { kelvin },
    intent: 'Auto white balance',
  };
}

/** Per-op auto params for the inspector's per-widget "Auto" button. Unlike
 *  the spawn-style `autoLight` / etc. (which build whole new widgets),
 *  these return ONLY the params relevant to the current widget's op and
 *  leave its other params untouched. Returns null when no sensible
 *  per-op auto exists for the requested op. */
export function autoParamsForOp(
  opId: string,
  m: MechanicalSnapshot,
): Record<string, number> | null {
  if (opId === 'light') {
    // Rolled-up Light: exposure to target median, contrast to widen
    // spread, plus highlight recovery / shadow lift for any clipping.
    const exposure = _clamp(((128 - m.medianLuma) / 128) * 60, -50, 50);
    const contrast = _clamp((140 - m.contrastP10P90) * 0.4, -20, 30);
    const highlights = m.clippedHighlightsPct > 0.5
      ? _clamp(-m.clippedHighlightsPct * 8, -50, 0) : 0;
    const shadows = m.clippedShadowsPct > 0.5
      ? _clamp(m.clippedShadowsPct * 0.8, 0, 50) : 0;
    return {
      exposure: Math.round(exposure),
      contrast: Math.round(contrast),
      highlights: Math.round(highlights),
      shadows: Math.round(shadows),
    };
  }
  if (opId === 'kelvin') return autoColor(m).params;
  if (opId === 'color') {
    // Cap saturation boost by current cast strength — a cast-heavy image
    // shouldn't get its colours pushed further.
    const sat = _clamp(15 - m.castStrength * 30, -10, 20);
    return { saturation: Math.round(sat) };
  }
  if (opId === 'levels') {
    // Map p1/p99 to black/white points so the histogram covers [0, 255].
    // Approximate p1 = first non-empty bin, p99 = last non-empty bin.
    let p1 = 0, p99 = 255;
    let total = 0;
    for (const c of m.lumaHistogram) total += c;
    if (total > 0) {
      let acc = 0;
      for (let i = 0; i < 256; i++) {
        acc += m.lumaHistogram[i];
        if (acc / total >= 0.01) { p1 = i; break; }
      }
      acc = 0;
      for (let i = 255; i >= 0; i--) {
        acc += m.lumaHistogram[i];
        if (acc / total >= 0.01) { p99 = i; break; }
      }
    }
    return { inBlack: p1, inWhite: p99, gamma: 1.0 };
  }
  return null;
}
