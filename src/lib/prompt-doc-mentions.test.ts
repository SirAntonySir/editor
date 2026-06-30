import { it, expect, describe } from 'vitest';
import { triggerBeforeCaret, caretTokenToReplace, parseTargetSourceId } from './prompt-doc';

describe('triggerBeforeCaret', () => {
  it('detects a bare @ (empty query → show all)', () => {
    expect(triggerBeforeCaret('fix the @')).toEqual({ trigger: '@', query: '' });
  });
  it('captures the query typed after @', () => {
    expect(triggerBeforeCaret('fix the @sky')).toEqual({ trigger: '@', query: 'sky' });
  });
  it('triggers at line start', () => {
    expect(triggerBeforeCaret('@sk')).toEqual({ trigger: '@', query: 'sk' });
  });
  it('does NOT trigger on a mid-word @ (e.g. email)', () => {
    expect(triggerBeforeCaret('a@b')).toEqual({ trigger: null, query: 'b' });
  });
  it('falls back to the plain word with no @', () => {
    expect(triggerBeforeCaret('fix sky')).toEqual({ trigger: null, query: 'sky' });
  });
});

describe('caretTokenToReplace', () => {
  it('returns the @mention token including the @', () => {
    expect(caretTokenToReplace('fix the @sky')).toBe('@sky');
    expect(caretTokenToReplace('fix the @')).toBe('@');
  });
  it('returns the plain word when there is no mention', () => {
    expect(caretTokenToReplace('fix sho')).toBe('sho');
    expect(caretTokenToReplace('fix ')).toBe('');
  });
});

describe('parseTargetSourceId', () => {
  it('parses node + layer target ids', () => {
    expect(parseTargetSourceId('target:node:n1')).toEqual({ kind: 'node', id: 'n1' });
    expect(parseTargetSourceId('target:layer:l9')).toEqual({ kind: 'layer', id: 'l9' });
  });
  it('returns null for region / unknown sourceIds', () => {
    expect(parseTargetSourceId('region:object:m1')).toBeNull();
    expect(parseTargetSourceId(undefined)).toBeNull();
  });
});
