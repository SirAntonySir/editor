import { describe, it, expect } from 'vitest';
import { planMergeVisible } from './merge-visible-layers';

const visibleOf = (set: Set<string>) => (id: string) => set.has(id);

describe('planMergeVisible', () => {
  it('collapses contiguous visible layers to the merged id at the bottommost slot', () => {
    // order is bottom→top: a (bottom) … c (top)
    const { newLayerIds, removedIds } = planMergeVisible(
      ['a', 'b', 'c'],
      visibleOf(new Set(['a', 'b', 'c'])),
      'M',
    );
    expect(newLayerIds).toEqual(['M']);
    expect(removedIds).toEqual(['a', 'b', 'c']);
  });

  it('keeps hidden layers in their original positions', () => {
    // a visible, b hidden, c visible  → merged sits at a's slot, b stays, c gone
    const { newLayerIds, removedIds } = planMergeVisible(
      ['a', 'b', 'c'],
      visibleOf(new Set(['a', 'c'])),
      'M',
    );
    expect(newLayerIds).toEqual(['M', 'b']);
    expect(removedIds).toEqual(['a', 'c']);
  });

  it('places the merged id at the bottommost visible slot when hidden is below', () => {
    // h (hidden, bottom), a, b (visible) → hidden stays at bottom, merged above it
    const { newLayerIds, removedIds } = planMergeVisible(
      ['h', 'a', 'b'],
      visibleOf(new Set(['a', 'b'])),
      'M',
    );
    expect(newLayerIds).toEqual(['h', 'M']);
    expect(removedIds).toEqual(['a', 'b']);
  });

  it('preserves a hidden layer on top', () => {
    const { newLayerIds } = planMergeVisible(
      ['a', 'b', 'top'],
      visibleOf(new Set(['a', 'b'])),
      'M',
    );
    expect(newLayerIds).toEqual(['M', 'top']);
  });
});
