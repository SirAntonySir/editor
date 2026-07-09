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
// Version bumps on every mutation so useSyncExternalStore sees a different
// snapshot value (the Map ref alone wouldn't change and React would skip
// the re-render).
let version = 0;

export const objectOwnership = {
  set(maskId: string, imageNodeId: string): void {
    owners.set(maskId, imageNodeId);
    version += 1;
    subscribers.forEach((fn) => fn());
  },
  get(maskId: string): string | undefined {
    return owners.get(maskId);
  },
  clear(maskId: string): void {
    if (!owners.delete(maskId)) return;
    version += 1;
    subscribers.forEach((fn) => fn());
  },
  /** Drop EVERY mapping. Document close/open must call this: node ids are
   *  recycled after `resetWorkspace` (counter restarts at `in-1`), so stale
   *  entries would re-attach the prior document's masks to the new nodes. */
  clearAll(): void {
    if (owners.size === 0) return;
    owners.clear();
    version += 1;
    subscribers.forEach((fn) => fn());
  },
  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  /** Returns a fresh integer on every mutation so useSyncExternalStore
   *  detects the change via Object.is. The underlying map is exposed via
   *  `get()` for the consumer. */
  snapshot(): number {
    return version;
  },
  _resetForTests(): void {
    owners.clear();
    subscribers.clear();
    version = 0;
  },
};
