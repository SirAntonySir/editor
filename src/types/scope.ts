// src/types/scope.ts
/** String alias kept for backwards-compat with segment-actions / mask-store APIs. */
export type MaskRef = string;

export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; mask_id: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string }
  | { kind: 'image_node'; image_node_id: string; layer_ids: string[] };

export const GLOBAL_SCOPE: Scope = { kind: 'global' };

export function scopeEquals(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'global') return true;
  if (a.kind === 'mask' && b.kind === 'mask') return a.mask_id === b.mask_id;
  if (a.kind === 'mask:proposed' && b.kind === 'mask:proposed') return a.label === b.label;
  if (a.kind === 'named_region' && b.kind === 'named_region') return a.label === b.label;
  if (a.kind === 'image_node' && b.kind === 'image_node') {
    return a.image_node_id === b.image_node_id
      && a.layer_ids.length === b.layer_ids.length
      && a.layer_ids.every((id, i) => id === b.layer_ids[i]);
  }
  return false;
}
