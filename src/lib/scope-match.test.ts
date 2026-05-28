import { describe, it, expect } from 'vitest';
import { scopeMatches } from './scope-match';
import type { Scope } from '@/types/scope';

describe('scopeMatches', () => {
  it('null active matches any target (global focus)', () => {
    expect(scopeMatches(null, { kind: 'global' })).toBe(true);
    expect(scopeMatches(null, { kind: 'mask', mask_id: 'm1' })).toBe(true);
  });

  it('global active matches global target only', () => {
    const g: Scope = { kind: 'global' };
    expect(scopeMatches(g, { kind: 'global' })).toBe(true);
    expect(scopeMatches(g, { kind: 'mask', mask_id: 'm1' })).toBe(false);
  });

  it('mask active matches same mask_id', () => {
    const m: Scope = { kind: 'mask', mask_id: 'm1' };
    expect(scopeMatches(m, { kind: 'mask', mask_id: 'm1' })).toBe(true);
    expect(scopeMatches(m, { kind: 'mask', mask_id: 'm2' })).toBe(false);
    expect(scopeMatches(m, { kind: 'global' })).toBe(false);
  });

  it('mask:proposed active matches same label', () => {
    const m: Scope = { kind: 'mask:proposed', label: 'face' };
    expect(scopeMatches(m, { kind: 'mask:proposed', label: 'face' })).toBe(true);
    expect(scopeMatches(m, { kind: 'mask:proposed', label: 'sky' })).toBe(false);
    expect(scopeMatches(m, { kind: 'global' })).toBe(false);
  });

  it('named_region active matches same label', () => {
    const m: Scope = { kind: 'named_region', label: 'sky' };
    expect(scopeMatches(m, { kind: 'named_region', label: 'sky' })).toBe(true);
    expect(scopeMatches(m, { kind: 'named_region', label: 'face' })).toBe(false);
  });
});
