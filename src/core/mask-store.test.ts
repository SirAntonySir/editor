import { describe, it, expect, beforeEach } from 'vitest';
import { maskStore } from './mask-store';
import type { Mask } from './mask-store';

function makeMask(overrides: Partial<Mask> = {}): Omit<Mask, 'id'> {
  return {
    layerId: 'L1',
    width: 4,
    height: 4,
    data: new Uint8Array(16).fill(255),
    source: 'sam-point',
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  maskStore.clear();
});

describe('maskStore.register', () => {
  it('assigns a unique id and stores the mask', () => {
    const id = maskStore.register(makeMask());
    expect(typeof id).toBe('string');
    const mask = maskStore.get(id);
    expect(mask?.width).toBe(4);
    expect(mask?.data.length).toBe(16);
  });

  it('preserves the provided label', () => {
    const id = maskStore.register(makeMask({ label: 'sky' }));
    expect(maskStore.get(id)?.label).toBe('sky');
  });
});

describe('maskStore.remove', () => {
  it('returns true when a mask is removed', () => {
    const id = maskStore.register(makeMask());
    expect(maskStore.remove(id)).toBe(true);
    expect(maskStore.get(id)).toBeUndefined();
  });

  it('returns false when the mask did not exist', () => {
    expect(maskStore.remove('missing')).toBe(false);
  });
});

describe('maskStore.clear', () => {
  it('removes all masks', () => {
    maskStore.register(makeMask());
    maskStore.register(makeMask());
    expect(maskStore.size).toBe(2);
    maskStore.clear();
    expect(maskStore.size).toBe(0);
  });
});

describe('maskStore.allForLayer', () => {
  it('returns all masks for a given layerId', () => {
    maskStore.register(makeMask({ layerId: 'L1', label: 'a' }));
    maskStore.register(makeMask({ layerId: 'L2', label: 'b' }));
    maskStore.register(makeMask({ layerId: 'L1', label: 'c' }));
    const layer1Masks = maskStore.allForLayer('L1');
    expect(layer1Masks).toHaveLength(2);
    expect(layer1Masks.map((m) => m.label).sort()).toEqual(['a', 'c']);
  });
});
