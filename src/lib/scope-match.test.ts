import { describe, it, expect } from 'vitest';
import { scopeMatches } from './scope-match';
import type { Scope } from '@/types/scope';

describe('scopeMatches', () => {
  it('null active matches any target (global focus)', () => {
    expect(scopeMatches(null, { kind: 'global' })).toBe(true);
    expect(scopeMatches(null, { kind: 'mask', maskRef: 'm1' })).toBe(true);
  });

  it('global active matches global target only', () => {
    const g: Scope = { kind: 'global' };
    expect(scopeMatches(g, { kind: 'global' })).toBe(true);
    expect(scopeMatches(g, { kind: 'mask', maskRef: 'm1' })).toBe(false);
  });

  it('mask active matches same maskRef', () => {
    const m: Scope = { kind: 'mask', maskRef: 'm1' };
    expect(scopeMatches(m, { kind: 'mask', maskRef: 'm1' })).toBe(true);
    expect(scopeMatches(m, { kind: 'mask', maskRef: 'm2' })).toBe(false);
    expect(scopeMatches(m, { kind: 'global' })).toBe(false);
  });

  it('mask active matches widget-side mask:click target with same id', () => {
    const m: Scope = { kind: 'mask', maskRef: 'm1' };
    expect(scopeMatches(m, { kind: 'mask:click', mask_id: 'm1' })).toBe(true);
    expect(scopeMatches(m, { kind: 'mask:click', mask_id: 'm2' })).toBe(false);
  });
});
