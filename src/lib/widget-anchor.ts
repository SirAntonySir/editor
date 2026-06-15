import type { Scope, WidgetAnchor } from '@/types/widget';

/** Map a widget Scope to its persistent WidgetAnchor.
 *
 *  Anchors are intentionally coarser than scopes — they're what the
 *  workspace pins a widget *position* to, not the editing target. The
 *  `image_node` case deliberately collapses to a global anchor: image
 *  nodes are workspace-level containers, not regions, and their
 *  `imageNodeId` / `layerIds` belong on the widget's scope (preserved
 *  separately) rather than its visual anchor. If a future feature wants
 *  to follow image-node positions, add an `image_node` anchor kind
 *  rather than overloading this mapping. */
export function anchorForScope(scope: Scope): WidgetAnchor {
  if (scope.kind === 'global') return { kind: 'global' };
  if (scope.kind === 'named_region') return { kind: 'region_label', label: scope.label };
  if (scope.kind === 'mask:proposed') return { kind: 'region_label', label: scope.label };
  if (scope.kind === 'mask') return { kind: 'mask_id', mask_id: scope.mask_id };
  if (scope.kind === 'image_node') return { kind: 'global' };
  return { kind: 'global' };
}
