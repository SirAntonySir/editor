import { describe, it, expect, beforeEach } from 'vitest';
import { scopeToMask } from './scope-to-mask';
import { maskStore } from '@/core/mask-store';

beforeEach(() => {
  maskStore.clear();
});

describe('scopeToMask', () => {
  it('returns null for global scope', () => {
    expect(scopeToMask({ kind: 'global' })).toBeNull();
  });

  it('resolves mask:click to the underlying mask bytes', () => {
    const ref = maskStore.register({
      layerId: 'l1', label: 'sky', width: 4, height: 4,
      data: new Uint8Array(16).fill(0),
      source: 'sam-point', createdAt: Date.now(),
    });
    const mask = scopeToMask({ kind: 'mask:click', mask_id: ref });
    expect(mask).not.toBeNull();
    expect(mask!.width).toBe(4);
    expect(mask!.height).toBe(4);
  });

  it('returns null for mask:click with missing mask_id', () => {
    expect(scopeToMask({ kind: 'mask:click' })).toBeNull();
  });

  it('resolves named_region by label lookup', () => {
    maskStore.register({
      layerId: 'l1', label: 'face-test-unique', width: 2, height: 2,
      data: new Uint8Array([1, 1, 0, 0]),
      source: 'ai-proposed', createdAt: Date.now(),
    });
    const mask = scopeToMask({ kind: 'named_region', label: 'face-test-unique' });
    expect(mask).not.toBeNull();
    expect(mask!.width).toBe(2);
  });
});
