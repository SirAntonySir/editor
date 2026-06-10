import { useEffect } from 'react';
import { useAiSession } from './useImageContext';
import { segmentStore } from '@/lib/segmentation/segment-store';

/** Bridges AI session `candidateRegions` into the per-ImageNode
 *  `segmentStore`. Phase 1 wiring: every ImageNode that mounts a
 *  SegmentHitLayer calls this hook with its id; whenever the active AI
 *  context changes, the regions land in the store keyed by that id.
 *
 *  Phase 4 (MobileSAM) will extend this hook to also publish
 *  per-ImageNode embeddings — until then, regions come from the backend. */
export function useSegmentInteraction(imageNodeId: string): void {
  const regions = useAiSession((s) => s.context?.candidateRegions);
  useEffect(() => {
    if (!regions || regions.length === 0) {
      segmentStore.clear(imageNodeId);
      return;
    }
    segmentStore.setRegions(imageNodeId, regions);
  }, [imageNodeId, regions]);
}
