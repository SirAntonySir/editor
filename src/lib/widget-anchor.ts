import type { Scope, WidgetAnchor } from '@/types/widget';

/** Map a widget Scope to its persistent WidgetAnchor.
 *
 *  Anchors are intentionally coarser than scopes — they're what the
 *  workspace pins a widget *position* to, not the editing target. */
export function anchorForScope(scope: Scope): WidgetAnchor {
  if (scope.kind === 'global') return { kind: 'global' };
  if (scope.kind === 'named_region') return { kind: 'region_label', label: scope.label };
  if (scope.kind === 'mask:proposed') return { kind: 'region_label', label: scope.label };
  if (scope.kind === 'mask') return { kind: 'mask_id', mask_id: scope.mask_id };
  return { kind: 'global' };
}
