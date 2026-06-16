import { describe, it, expect, beforeEach } from 'vitest';
import { objectIdToMask } from './scope-to-mask';
import { maskStore } from '@/core/mask-store';

beforeEach(() => {
  maskStore.clear();
});

describe('objectIdToMask', () => {
  it('returns null for null id (whole image)', () => {
    expect(objectIdToMask(null)).toBeNull();
  });

  it('returns the mask for a known id', () => {
    const ref = maskStore.register({
      layerId: 'L1',
      source: 'sam-point',
      width: 4,
      height: 4,
      data: new Uint8Array(16),
      createdAt: Date.now(),
    });
    expect(objectIdToMask(ref)?.layerId).toBe('L1');
    maskStore.remove(ref);
  });

  it('returns null for an unknown id', () => {
    expect(objectIdToMask('missing-mask')).toBeNull();
  });
});
