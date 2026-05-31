import type { ParamDefinition } from '@/types/processing';

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

/** Collapsed summary text + dirty flag for a scalar section, derived from the
 * canonical params of its (layer, op) node. Non-default params only. */
export function sectionSummary(
  params: ParamDefinition[],
  canonical: Record<string, unknown>,
): { summary: string; dirty: boolean } {
  const parts: string[] = [];
  for (const p of params) {
    const raw = canonical[p.key];
    const v = typeof raw === 'number' ? raw : p.default;
    if (v !== p.default) parts.push(`${p.label} ${signed(v)}`);
  }
  return parts.length === 0
    ? { summary: '—', dirty: false }
    : { summary: parts.join(', '), dirty: true };
}
