import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../loader';

describe('loadRegistry', () => {
  it('finds all 17 ops', () => {
    const reg = loadRegistry();
    const expected = new Set([
      'light', 'color', 'kelvin', 'levels', 'hsl', 'sharpen',
      'blur', 'clarity', 'grain', 'vignette', 'splitTone', 'curves',
      'time-of-day', 'age', 'mood', 'season', 'weather',
    ]);
    expect(new Set(Object.keys(reg.ops))).toEqual(expected);
  });

  it('parses the new icon + category fields on ops and presets', () => {
    const reg = loadRegistry();
    expect(reg.ops['light'].icon).toBe('light_mode');
    expect(reg.ops['light'].category).toBe('tone');
    expect(reg.presets['golden_hour'].category).toBe('mood');
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
