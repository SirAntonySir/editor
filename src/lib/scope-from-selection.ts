import type { Scope } from '@/types/scope';

export function scopeFromSelection(activeObjectId: string | null): Scope {
  return activeObjectId === null
    ? { kind: 'global' }
    : { kind: 'mask', mask_id: activeObjectId };
}
