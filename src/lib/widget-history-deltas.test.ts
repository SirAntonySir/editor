import { describe, expect, it } from 'vitest';
import { computeParamDeltas } from './widget-history-deltas';

type Params = Record<string, Record<string, unknown>>;

describe('computeParamDeltas', () => {
  it('reports a changed param with from/to', () => {
    const before: Params = { n1: { exposure: 0.5 } };
    const after: Params = { n1: { exposure: 0.3 } };
    expect(computeParamDeltas(before, after)).toEqual([
      { param: 'exposure', from: 0.5, to: 0.3 },
    ]);
  });

  it('ignores unchanged params', () => {
    const before: Params = { n1: { exposure: 0.5, contrast: 0.2 } };
    const after: Params = { n1: { exposure: 0.3, contrast: 0.2 } };
    expect(computeParamDeltas(before, after)).toEqual([
      { param: 'exposure', from: 0.5, to: 0.3 },
    ]);
  });

  it('treats an added param as from=undefined', () => {
    const before: Params = { n1: {} };
    const after: Params = { n1: { exposure: 0.3 } };
    expect(computeParamDeltas(before, after)).toEqual([
      { param: 'exposure', from: undefined, to: 0.3 },
    ]);
  });

  it('flattens across multiple nodes', () => {
    const before: Params = { n1: { exposure: 0.5 }, n2: { hue: 10 } };
    const after: Params = { n1: { exposure: 0.5 }, n2: { hue: 20 } };
    expect(computeParamDeltas(before, after)).toEqual([
      { param: 'hue', from: 10, to: 20 },
    ]);
  });

  it('returns empty when nothing changed', () => {
    const before: Params = { n1: { exposure: 0.5 } };
    const after: Params = { n1: { exposure: 0.5 } };
    expect(computeParamDeltas(before, after)).toEqual([]);
  });
});
