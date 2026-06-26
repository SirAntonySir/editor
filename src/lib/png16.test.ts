import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { isPng16, decodePng16 } from './png16';

function png16(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = rgb[0];
    data[i * 3 + 1] = rgb[1];
    data[i * 3 + 2] = rgb[2];
  }
  return encode({ width, height, data, channels: 3, depth: 16 });
}

describe('isPng16', () => {
  it('is true for a 16-bit PNG', () => {
    expect(isPng16(png16(2, 2, [1000, 2000, 3000]))).toBe(true);
  });

  it('is false for an 8-bit PNG', () => {
    const p8 = encode({ width: 2, height: 2, data: new Uint8Array(2 * 2 * 3), channels: 3, depth: 8 });
    expect(isPng16(p8)).toBe(false);
  });

  it('is false for non-PNG bytes', () => {
    expect(isPng16(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });
});

describe('decodePng16', () => {
  it('decodes to RGBA Uint16, expanding RGB with opaque alpha', () => {
    const out = decodePng16(png16(2, 2, [1000, 2000, 3000]));
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data).toBeInstanceOf(Uint16Array);
    expect(out.data.length).toBe(2 * 2 * 4);
    expect([out.data[0], out.data[1], out.data[2], out.data[3]]).toEqual([1000, 2000, 3000, 65535]);
  });
});
