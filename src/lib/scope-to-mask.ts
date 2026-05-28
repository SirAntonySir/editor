import { maskStore, type Mask } from '@/core/mask-store';
import type { Scope } from '@/types/widget';

/** Resolve a widget Scope to a concrete mask. Returns null for global scope
 *  (no mask = applies to whole image). */
export function scopeToMask(scope: Scope): Mask | null {
  if (scope.kind === 'global') return null;
  if (scope.kind === 'mask:click') {
    if (!scope.mask_id) return null;
    return maskStore.get(scope.mask_id) ?? null;
  }
  // named_region / mask:proposed — look up by label.
  const label = scope.label;
  for (const mask of maskStore.all()) {
    if (mask.label === label) return mask;
  }
  return null;
}
