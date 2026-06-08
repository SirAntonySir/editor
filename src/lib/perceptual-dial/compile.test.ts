import { describe, it, expect } from 'vitest';
import { compileToWidgetParams } from './compile';

describe('compileToWidgetParams', () => {
  it('groups flat ${op}.${param} keys into per-op patches', () => {
    const out = compileToWidgetParams({
      'light.exposure': 0.2,
      'light.contrast': 10,
      'kelvin.kelvin': 3400,
      'color.vibrance': 12,
    });
    // Order is stable: keys sorted ascending by op for deterministic diffs.
    expect(out).toEqual([
      { op: 'color',  params: { vibrance: 12 } },
      { op: 'kelvin', params: { kelvin: 3400 } },
      { op: 'light',  params: { exposure: 0.2, contrast: 10 } },
    ]);
  });

  it('ignores keys without a dot separator', () => {
    const out = compileToWidgetParams({
      'light.exposure': 0.2,
      'malformed': 99,
      '.dangling': 1,
      'no_dot_key': 1,
    });
    expect(out).toEqual([{ op: 'light', params: { exposure: 0.2 } }]);
  });

  it('returns [] for empty input', () => {
    expect(compileToWidgetParams({})).toEqual([]);
  });
});
