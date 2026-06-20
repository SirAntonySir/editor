import { describe, it, expect } from 'vitest';
import { maskMatchesImageNode } from './mask-filters';

describe('maskMatchesImageNode', () => {
  it('keeps masks with no imageNodeId visible regardless of active node', () => {
    expect(maskMatchesImageNode({ imageNodeId: undefined }, 'image-1')).toBe(true);
    expect(maskMatchesImageNode({ imageNodeId: null }, 'image-1')).toBe(true);
    expect(maskMatchesImageNode({ imageNodeId: undefined }, null)).toBe(true);
  });

  it('keeps masks visible when their imageNodeId matches the active node', () => {
    expect(maskMatchesImageNode({ imageNodeId: 'image-1' }, 'image-1')).toBe(true);
  });

  it('hides masks when their imageNodeId differs from the active node', () => {
    expect(maskMatchesImageNode({ imageNodeId: 'image-1' }, 'image-2')).toBe(false);
  });

  it('keeps targeted masks visible when no node is active', () => {
    expect(maskMatchesImageNode({ imageNodeId: 'image-1' }, null)).toBe(true);
  });
});
