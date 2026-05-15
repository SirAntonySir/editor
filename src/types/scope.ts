// src/types/scope.ts
export type MaskRef = string;

export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; maskRef: MaskRef }
  | { kind: 'mask:proposed'; label: string; representativePoint: [number, number]; confidence?: number };

export function scopeEquals(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'global') return true;
  if (a.kind === 'mask' && b.kind === 'mask') return a.maskRef === b.maskRef;
  if (a.kind === 'mask:proposed' && b.kind === 'mask:proposed') {
    return a.label === b.label
      && a.representativePoint[0] === b.representativePoint[0]
      && a.representativePoint[1] === b.representativePoint[1];
  }
  return false;
}

export const GLOBAL_SCOPE: Scope = { kind: 'global' };
