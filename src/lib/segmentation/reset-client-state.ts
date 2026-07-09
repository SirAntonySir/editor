/**
 * Document-scoped reset for CLIENT segmentation state. Called by
 * `closeDocument` and `openImage` alongside the pixel/history clears.
 *
 * Why this must exist: `resetWorkspace()` restarts the node-id counter, so
 * the next document's image node is minted `in-1` AGAIN. Any module-level
 * state keyed by image-node id therefore survives a close and silently
 * re-attaches to the new document — the SAM embedding caches decode the
 * PRIOR image's masks onto the new image, and stale maskStore /
 * objectOwnership entries resurrect the old objects.
 */
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { clearMobileSamCache } from '@/hooks/useMobileSam';
import { clearSegmentEncoderCache } from '@/lib/segmentation/segment-region';

export function resetSegmentationClientState(): void {
  maskStore.clear();
  objectOwnership.clearAll();
  clearMobileSamCache();
  clearSegmentEncoderCache();
}
