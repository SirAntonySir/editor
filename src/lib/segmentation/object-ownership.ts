/**
 * Client-side mapping of `mask_id → imageNodeId`. The backend's
 * `mask.created` SSE event carries the mask metadata + PNG bytes but no
 * association to a workspace image-node, and the frontend's SSE handler
 * stamps every committed mask with the synthetic `layerId: 'ai-proposed'`.
 * That's fine for hit-test bookkeeping in maskStore, but it loses the
 * "which node owns this object" link.
 *
 * Since propose_mask is always invoked with an explicit `imageNodeId`, the
 * caller knows the answer at commit time. This module is the tiny memory
 * the workspace components read to filter masks_index per node.
 *
 * Lives only in client memory — after a reload the map is empty, and the
 * objects layer will reappear once we wire the backend to round-trip
 * imageNodeId on persisted masks (separate plan).
 */

const owners = new Map<string, string>();
const subscribers = new Set<() => void>();

export const objectOwnership = {
  set(maskId: string, imageNodeId: string): void {
    owners.set(maskId, imageNodeId);
    subscribers.forEach((fn) => fn());
  },
  get(maskId: string): string | undefined {
    return owners.get(maskId);
  },
  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  /** Stable identity that changes when any mapping does — for
   *  useSyncExternalStore. */
  snapshot(): Map<string, string> {
    return owners;
  },
  _resetForTests(): void {
    owners.clear();
    subscribers.clear();
  },
};
