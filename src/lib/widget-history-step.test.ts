import { describe, expect, it } from 'vitest';
import { resolveStep } from './widget-history-step';

const E = (id: string) => ({ id });

describe('resolveStep', () => {
  const entries = [E('a'), E('b'), E('c')]; // chronological: oldest → newest

  it('reports the current index from currentEntryId', () => {
    expect(resolveStep(entries, 'b').index).toBe(1);
    expect(resolveStep(entries, 'b').total).toBe(3);
  });

  it('prev targets the older neighbour, next the newer', () => {
    const s = resolveStep(entries, 'b');
    expect(s.prevId).toBe('a');
    expect(s.nextId).toBe('c');
  });

  it('prev is null at the oldest entry, next null at the newest', () => {
    expect(resolveStep(entries, 'a').prevId).toBeNull();
    expect(resolveStep(entries, 'c').nextId).toBeNull();
  });

  it('falls back to the newest entry when currentEntryId is null', () => {
    const s = resolveStep(entries, null);
    expect(s.index).toBe(2);
    expect(s.nextId).toBeNull();
    expect(s.prevId).toBe('b');
  });

  it('handles an empty timeline', () => {
    const s = resolveStep([], null);
    expect(s.index).toBe(-1);
    expect(s.total).toBe(0);
    expect(s.prevId).toBeNull();
    expect(s.nextId).toBeNull();
  });

  it('treats an unknown currentEntryId as newest', () => {
    const s = resolveStep(entries, 'zzz');
    expect(s.index).toBe(2);
  });
});
