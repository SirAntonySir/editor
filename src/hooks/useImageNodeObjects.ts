import { useMemo, useSyncExternalStore } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { maskStore, type Mask } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

export interface ImageObject {
  id: string;
  mask: Mask;
  label: string;
  /** Inclusive pixel bounds in mask space. Null when the mask is empty. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function maskBbox(mask: Mask): ImageObject['bbox'] | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] !== 255) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Resolves the committed objects (client-saved masks) belonging to an
 * image-node. The backend's `mask.created` SSE event has no imageNodeId
 * on it, so we filter via the `objectOwnership` map that the commit path
 * populates after each successful `propose_mask`.
 */
export function useImageNodeObjects(imageNodeId: string): ImageObject[] {
  const masksIndex = useBackendState((s) => s.snapshot?.masksIndex);
  // Re-render when any mapping in objectOwnership changes; the version is
  // also memo key so the filter re-runs on ownership mutations.
  const ownershipVersion = useSyncExternalStore(
    objectOwnership.subscribe,
    objectOwnership.snapshot,
    objectOwnership.snapshot,
  );

  return useMemo(() => {
    if (!masksIndex) return [];
    const out: ImageObject[] = [];
    const seen = new Set<string>();
    let autoIdx = 0;
    for (const entry of masksIndex) {
      const id = (entry as { id?: string }).id;
      if (!id) continue;
      // Dedup by id: masksIndex should hold one row per mask, but a duplicate
      // (SSE/refetch race) must never render as multiple identical objects.
      if (seen.has(id)) continue;
      seen.add(id);
      // objectOwnership wins when set — it's the client's authoritative
      // mapping for masks it proposed (the backend's `image_node_id` can
      // drift, e.g. legacy `in-default`). For backend-only masks with no
      // client ownership entry, fall back to the MaskSummary's imageNodeId.
      const owner = objectOwnership.get(id);
      const targeted = (entry as { imageNodeId?: string | null }).imageNodeId;
      if (owner) {
        if (owner !== imageNodeId) continue;
      } else {
        if (targeted && targeted !== imageNodeId) continue;
        if (!targeted) continue;
      }
      const mask = maskStore.get(id);
      if (!mask) continue;
      const bbox = maskBbox(mask);
      if (!bbox) continue;
      const label = (entry as { label?: string | null }).label ?? mask.label ?? `Object ${autoIdx + 1}`;
      autoIdx += 1;
      out.push({ id, mask, label, bbox });
    }
    return out;
    // ownershipVersion is part of the deps so the filter re-runs whenever
    // a new mask gets owned (or one is reassigned).
  }, [masksIndex, imageNodeId, ownershipVersion]);
}
