import type { CompoundParams, OpPatch } from './types';

/**
 * Group a flat compound-params record into per-op patches.
 * Keys must look like `${op}.${param}` (both non-empty). Malformed keys are dropped.
 * Output is sorted alphabetically by op for deterministic diffs.
 */
export function compileToWidgetParams(compound: CompoundParams): OpPatch[] {
  const byOp = new Map<string, Record<string, number>>();
  for (const [key, value] of Object.entries(compound)) {
    const dot = key.indexOf('.');
    if (dot <= 0 || dot === key.length - 1) continue;
    const op = key.slice(0, dot);
    const param = key.slice(dot + 1);
    let bucket = byOp.get(op);
    if (!bucket) {
      bucket = {};
      byOp.set(op, bucket);
    }
    bucket[param] = value;
  }
  return Array.from(byOp.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([op, params]) => ({ op, params }));
}
