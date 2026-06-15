import { describe, it, expect } from 'vitest';
import { HSL_BANDS, bandDisplayColor, hueTrack, satTrack, lumTrack } from '@/components/widget/hsl/hsl-bands';

describe('HSL_BANDS', () => {
  it('lists the 8 bands in canonical order with shader-matching hue centres', () => {
    expect(HSL_BANDS.map((b) => b.key)).toEqual([
      'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta',
    ]);
    // centres mirror CENTERS[] in src/shaders/hsl.glsl.ts (normalised hue 0..1)
    expect(HSL_BANDS.map((b) => b.centerHue)).toEqual([
      0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.8333,
    ]);
  });

  it('gives every band a human label', () => {
    for (const b of HSL_BANDS) expect(b.label.length).toBeGreaterThan(0);
  });
});

describe('bandDisplayColor', () => {
  it('encodes the hue as a deterministic hsl() string', () => {
    const blue = HSL_BANDS.find((b) => b.key === 'blue')!;
    const c = bandDisplayColor(blue.centerHue);
    expect(c).toMatch(/^hsl\(/);
    expect(c).toContain('240'); // 0.6667 * 360 ≈ 240°
    expect(bandDisplayColor(blue.centerHue)).toBe(c); // pure
  });
});

describe('track gradients', () => {
  const blue = 0.6667;
  it('hue track is a 3-stop gradient around the centre hue', () => {
    const g = hueTrack(blue);
    expect(g).toMatch(/^linear-gradient\(90deg,/);
    expect(g.match(/hsl\(/g)?.length).toBe(3);
  });
  it('saturation track runs from desaturated to the band colour', () => {
    const g = satTrack(blue);
    expect(g).toMatch(/^linear-gradient\(90deg,/);
    expect(g).toContain('240');
  });
  it('luminance track runs dark → band → light', () => {
    const g = lumTrack(blue);
    expect(g).toMatch(/^linear-gradient\(90deg,/);
    expect(g.match(/hsl\(/g)?.length).toBe(3);
  });
});
