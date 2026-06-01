import type { ParamDefinition } from '@/types/processing';

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
