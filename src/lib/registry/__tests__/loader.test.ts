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

  it('loads the builtin preset files', () => {
    const reg = loadRegistry();
    // Builtin presets were added in the registry (40 at time of writing).
    expect(Object.keys(reg.presets).length).toBeGreaterThan(0);
  });
});
