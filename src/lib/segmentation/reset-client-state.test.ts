/**
 * Tests for resetSegmentationClientState — the document-close/open reset for
 * client segmentation state. Root-cause regression for: after File→Close,
 * `resetWorkspace()` restarts the node-id counter, so the next image's node is
 * minted `in-1` AGAIN and every module cache keyed by image-node id serves the
 * PRIOR image's data — the SAM embedding cache decodes old-image masks onto
 * the new image, and stale maskStore/objectOwnership entries re-attach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClearMobileSamCache, mockClearSegmentEncoderCache } = vi.hoisted(() => ({
  mockClearMobileSamCache: vi.fn(),
  mockClearSegmentEncoderCache: vi.fn(),
}));

vi.mock('@/hooks/useMobileSam', () => ({
  clearMobileSamCache: mockClearMobileSamCache,
}));
vi.mock('@/lib/segmentation/segment-region', () => ({
  clearSegmentEncoderCache: mockClearSegmentEncoderCache,
}));

import { resetSegmentationClientState } from './reset-client-state';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

beforeEach(() => {
  vi.clearAllMocks();
  maskStore.clear();
});

describe('resetSegmentationClientState', () => {
  it('empties maskStore and objectOwnership and drops both embedding caches', () => {
    const ref = maskStore.register({
      layerId: 'old-layer',
      width: 2,
      height: 2,
      data: new Uint8Array(4).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });
    objectOwnership.set(ref, 'in-1');
    expect(maskStore.size).toBe(1);
    expect(objectOwnership.get(ref)).toBe('in-1');

    resetSegmentationClientState();

    expect(maskStore.size).toBe(0);
    expect(objectOwnership.get(ref)).toBeUndefined();
    // No-arg = clear ALL nodes' embeddings (ids get recycled after close).
    expect(mockClearMobileSamCache).toHaveBeenCalledWith();
    expect(mockClearSegmentEncoderCache).toHaveBeenCalledWith();
  });
});
