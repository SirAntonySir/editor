import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../loader';

describe('loadRegistry', () => {
  it('finds all 12 ops', () => {
    const reg = loadRegistry();
    const expected = new Set([
      'light', 'color', 'kelvin', 'levels', 'hsl', 'sharpen',
      'blur', 'clarity', 'grain', 'vignette', 'splitTone', 'curves',
    ]);
    expect(new Set(Object.keys(reg.ops))).toEqual(expected);
  });

  it('parses op typed shape', () => {
    const reg = loadRegistry();
    const light = reg.ops['light'];
    expect(light.display_name).toBe('Light');
    expect(light.params.exposure.range).toEqual([-100, 100]);
    expect(light.engine.shader).toBe('basic');
  });

  it('returns empty presets when no preset files exist yet', () => {
    const reg = loadRegistry();
    expect(Object.keys(reg.presets).length).toBe(0);
  });
});
