import type { Scope } from '@/types/scope';

type TargetScope =
  | Scope
  | { kind: 'mask:click'; mask_id?: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string };

/**
 * Returns true when a widget/row scoped to `target` should render at full
 * opacity given the current `active` selection. A null `active` means "no
 * narrowing" — everything is full opacity.
 */
export function scopeMatches(active: Scope | null, target: TargetScope | null | undefined): boolean {
  if (!active) return true;
  if (!target) return active.kind === 'global';

  if (active.kind === 'global') {
    return target.kind === 'global';
  }

  if (active.kind === 'mask') {
    if (target.kind === 'mask') return target.maskRef === active.maskRef;
    if (target.kind === 'mask:click') return target.mask_id === active.maskRef;
    return false;
  }

  if (active.kind === 'mask:proposed' && target.kind === 'mask:proposed') {
    return target.label === active.label;
  }
  return false;
}
