// src/types/scope.ts
/** String alias kept for backwards-compat with segment-actions / mask-store APIs. */
export type MaskRef = string;

export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; mask_id: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string };

export const GLOBAL_SCOPE: Scope = { kind: 'global' };

/** Reserved image-node id for the "primary" image — mirrors the backend
 *  DEFAULT_IMAGE_NODE_ID. All call sites that don't yet know which
 *  ImageNode they target use this id. */
export const DEFAULT_IMAGE_NODE_ID = 'in-default';

export function scopeEquals(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'global') return true;
  if (a.kind === 'mask' && b.kind === 'mask') return a.mask_id === b.mask_id;
  if (a.kind === 'mask:proposed' && b.kind === 'mask:proposed') return a.label === b.label;
  if (a.kind === 'named_region' && b.kind === 'named_region') return a.label === b.label;
  return false;
}
