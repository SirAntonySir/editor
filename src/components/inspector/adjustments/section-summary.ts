import type { ParamDefinition } from '@/types/processing';

/** The 2-point identity ramp a fresh curves channel holds. */
export const IDENTITY_CURVE_PAIRS: [number, number][] = [[0, 0], [255, 255]];

/** Channels a canonical curves node stores (`[[x, y], ...]` in 0–255 space). */
export const CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;

/** True when a canonical curves param holds the identity ramp
 *  `[[0, 0], [255, 255]]`. Undefined / missing / shape-mismatched values
 *  count as identity so touched-detection stays silent for fresh sessions
 *  and legacy documents that haven't been touched. */
export function isIdentityCurvePairs(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [a, b] = v as [unknown, unknown];
  return (
    Array.isArray(a) && a.length === 2 && a[0] === 0 && a[1] === 0 &&
    Array.isArray(b) && b.length === 2 && b[0] === 255 && b[1] === 255
  );
}

/** Collapsed summary for a section's collapsed-row badge. Counts non-default
 * params of the (layer, op) canonical node — that's the number of sliders the
 * user has visibly touched. `dirty` is true iff `touchedCount > 0`. */
export function sectionSummary(
  params: ParamDefinition[],
  canonical: Record<string, unknown>,
): { touchedCount: number; dirty: boolean } {
  let touchedCount = 0;
  for (const p of params) {
    const raw = canonical[p.key];
    const v = typeof raw === 'number' ? raw : p.default;
    if (v !== p.default) touchedCount += 1;
  }
  return { touchedCount, dirty: touchedCount > 0 };
}
