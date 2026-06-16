import { maskStore, type Mask } from '@/core/mask-store';

export function objectIdToMask(id: string | null): Mask | null {
  if (id === null) return null;
  return maskStore.get(id) ?? null;
}
