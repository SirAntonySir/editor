import { it, expect, describe } from 'vitest';
import { rankElements, type PaletteElement } from './region-suggest';

const ELEMENTS: PaletteElement[] = [
  { kind: 'region', label: 'shoes', sourceId: 'region:object:m1' },
  { kind: 'region', label: 'sky', sourceId: 'region:ai:sky' },
  { kind: 'target', targetKind: 'node', label: 'Portrait.jpg', sourceId: 'target:node:n1' },
  { kind: 'target', targetKind: 'layer', label: 'Background', sourceId: 'target:layer:l1' },
];

describe('rankElements', () => {
  it('lists everything (up to limit) on an empty query when allowEmpty', () => {
    const out = rankElements(ELEMENTS, '', { allowEmpty: true, limit: 24, minChars: 1 });
    expect(out).toHaveLength(4);
  });

  it('returns [] on empty query without allowEmpty (inline-typing parity)', () => {
    expect(rankElements(ELEMENTS, '')).toEqual([]);
  });

  it('filters across regions AND targets, preserving kind', () => {
    const out = rankElements(ELEMENTS, 'port', { minChars: 1 });
    expect(out.map((e) => e.sourceId)).toEqual(['target:node:n1']);
    expect(out[0].kind).toBe('target');
  });

  it('honours the limit', () => {
    const many: PaletteElement[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'region', label: `sky ${i}`, sourceId: `region:ai:sky-${i}`,
    }));
    expect(rankElements(many, '', { allowEmpty: true, limit: 6 })).toHaveLength(6);
  });
});
