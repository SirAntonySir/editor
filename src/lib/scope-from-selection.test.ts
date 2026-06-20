import { describe, it, expect } from 'vitest';
import { scopeFromSelection } from './scope-from-selection';

describe('scopeFromSelection', () => {
  it('returns global when no object is active', () => {
    expect(scopeFromSelection(null)).toEqual({ kind: 'global' });
  });
  it('returns mask scope when an object is active', () => {
    expect(scopeFromSelection('m-7')).toEqual({ kind: 'mask', mask_id: 'm-7' });
  });
});
