import { describe, expect, it, vi } from 'vitest';
import { encode } from 'fast-png';
import { isPng16, decodePng16, sniffPng16 } from './png16';

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

describe('sniffPng16', () => {
  const PNG16_HEADER = (() => {
    // Minimal 26-byte prefix: PNG signature + IHDR through the bit-depth byte.
    const b = new Uint8Array(26);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b[24] = 16; // IHDR bit depth
    return b;
  })();

  function fileLike(header: Uint8Array) {
    const slice = vi.fn((start: number, end: number) => ({
      arrayBuffer: async () => header.slice(start, end).buffer,
    }));
    const arrayBuffer = vi.fn(async () => header.buffer);
    return { file: { slice, arrayBuffer } as unknown as File, slice, arrayBuffer };
  }

  it('detects a 16-bit PNG from the header slice alone — never reads the full file', async () => {
    const { file, slice, arrayBuffer } = fileLike(PNG16_HEADER);
    await expect(sniffPng16(file)).resolves.toBe(true);
    expect(slice).toHaveBeenCalledWith(0, 26);
    // THE point of the sniff: a 40 MB JPEG must not be fully read just to
    // discover it isn't a PNG. Full reads happen only after a positive sniff.
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a JPEG header without reading the full file', async () => {
    const jpeg = new Uint8Array(26);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    const { file, arrayBuffer } = fileLike(jpeg);
    await expect(sniffPng16(file)).resolves.toBe(false);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects an 8-bit PNG header', async () => {
    const png8 = PNG16_HEADER.slice();
    png8[24] = 8;
    const { file } = fileLike(png8);
    await expect(sniffPng16(file)).resolves.toBe(false);
  });
});
