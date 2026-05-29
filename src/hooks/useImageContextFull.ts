import { useBackendState } from '@/store/backend-state-slice';
import type { EnrichedImageContext } from '@/types/enriched-context';

/**
 * Returns the backend's image_context narrowed to EnrichedImageContext, or
 * null when no snapshot has arrived yet. The narrowing is intentionally
 * trusting — the contract is owned by the backend; if its shape drifts,
 * sections render best-effort.
 */
export function useImageContextFull(): EnrichedImageContext | null {
  return useBackendState((s) => {
    const ctx = s.snapshot?.image_context;
    return ctx ? (ctx as EnrichedImageContext) : null;
  });
}
