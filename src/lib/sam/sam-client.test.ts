import { describe, it, expect } from 'vitest';
import { maskAlphaFromRgba } from './sam-client';

/** Build an RGBA byte buffer from a per-pixel [r,g,b,a] list. */
function rgba(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  });
  return buf;
}

describe('maskAlphaFromRgba', () => {
  it('decodes a 1-channel grayscale mask (object = white, bg = black)', () => {
    // The documented backend contract: a grayscale PNG decodes to RGBA with
    // R=G=B and full alpha. Object pixel is white (255), background black (0).
    const buf = rgba([
      [255, 255, 255, 255], // object
      [0, 0, 0, 255],       // background
    ]);
    expect(Array.from(maskAlphaFromRgba(buf, 2))).toEqual([255, 0]);
  });

  it('REPRO (extract-object full-copy bug): RGBA mask with the shape in the ALPHA channel', () => {
    // SAM/PIL can export a mask as RGBA where the shape lives in the ALPHA
    // channel and RGB is opaque white everywhere. Object = alpha 255,
    // background = alpha 0.
    const buf = rgba([
      [255, 255, 255, 255], // object   (alpha 255)
      [255, 255, 255, 0],   // bg       (alpha 0)
      [255, 255, 255, 0],   // bg
      [255, 255, 255, 0],   // bg
    ]);
    const mask = Array.from(maskAlphaFromRgba(buf, 4));

    // The mask MUST reflect the alpha shape: only pixel 0 is the object.
    //
    // The current red-only read instead returns [255, 255, 255, 255] — a
    // fully-opaque mask. In extractLayerFromMask that makes `destination-in`
    // keep every pixel and computeMaskBbox span the whole frame, so the
    // "extracted object" is a verbatim copy of the source image. This is the
    // intermittent "source is also the extracted image" bug.
    expect(mask).toEqual([255, 0, 0, 0]);
  });
});
