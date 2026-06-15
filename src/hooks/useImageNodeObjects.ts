import { useMemo } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore, type Mask } from '@/core/mask-store';

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
 * image-node. The backend stores every mask in `snapshot.masksIndex` keyed
 * by `mask_id`; the per-mask `layerId` lives on the maskStore entry that
 * the SSE subscriber populated from the `mask.proposed` payload. We filter
 * to masks whose layerId is one of this node's layers.
 */
export function useImageNodeObjects(imageNodeId: string): ImageObject[] {
  const masksIndex = useBackendState((s) => s.snapshot?.masksIndex);
  const layerIds = useEditorStore((s) => s.imageNodes[imageNodeId]?.layerIds);

  return useMemo(() => {
    if (!masksIndex || !layerIds) return [];
    const layerSet = new Set(layerIds);
    const out: ImageObject[] = [];
    let autoIdx = 0;
    for (const entry of masksIndex) {
      const id = (entry as { id?: string }).id;
      if (!id) continue;
      const mask = maskStore.get(id);
      if (!mask) continue;
      if (!layerSet.has(mask.layerId)) continue;
      const bbox = maskBbox(mask);
      if (!bbox) continue;
      const label = (entry as { label?: string | null }).label ?? mask.label ?? `Object ${autoIdx + 1}`;
      autoIdx += 1;
      out.push({ id, mask, label, bbox });
    }
    return out;
  }, [masksIndex, layerIds]);
}
