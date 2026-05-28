import type { Scope } from '@/types/scope';

/**
 * Returns true when a widget/row scoped to `target` should render at full
 * opacity given the current `active` selection. A null `active` means "no
 * narrowing" — everything is full opacity.
 */
export function scopeMatches(active: Scope | null, target: Scope | null | undefined): boolean {
  if (!active) return true;
  if (!target) return active.kind === 'global';

  if (active.kind === 'global') {
    return target.kind === 'global';
  }

  if (active.kind === 'mask' && target.kind === 'mask') {
    return target.mask_id === active.mask_id;
  }

  if (active.kind === 'mask:proposed' && target.kind === 'mask:proposed') {
    return target.label === active.label;
  }

  if (active.kind === 'named_region' && target.kind === 'named_region') {
    return target.label === active.label;
  }

  return false;
}
