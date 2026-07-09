import { decode } from 'fast-png';

/** A decoded high-bit-depth image: RGBA, 16-bit per channel, row-major. */
export interface HiBitImage {
  data: Uint16Array; // length = width * height * 4 (RGBA)
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Cheap detector: is this a 16-bit PNG? Checks the 8-byte signature and the
 * IHDR bit-depth byte (offset 24). Lets the open path decide whether to take
 * the high-bit-depth branch without a full decode.
 */
export function isPng16(bytes: Uint8Array): boolean {
  if (bytes.length < 26) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return bytes[24] === 16; // IHDR bit depth
}

/**
 * Header-only 16-bit-PNG check: reads the first 26 bytes (signature + IHDR
 * bit depth) via `Blob.slice`, never the full file. The image-open path must
 * not pull a 40 MB JPEG through `arrayBuffer()` just to learn it isn't a
 * PNG — full reads belong after a positive sniff.
 */
export async function sniffPng16(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 26).arrayBuffer());
    return isPng16(head);
  } catch {
    return false;
  }
}

/**
 * Decode a 16-bit PNG into an RGBA Uint16 buffer. RGB sources are expanded to
 * RGBA with opaque alpha (65535) so the result uploads directly as an
 * `RGBA16F` texture.
 */
export function decodePng16(bytes: Uint8Array): HiBitImage {
  const png = decode(bytes);
  const { width, height, channels } = png;
  const src = png.data as Uint16Array;
  const out = new Uint16Array(width * height * 4);
  const px = width * height;
  if (channels === 4) {
    out.set(src);
  } else if (channels === 3) {
    for (let i = 0; i < px; i++) {
      out[i * 4] = src[i * 3];
      out[i * 4 + 1] = src[i * 3 + 1];
      out[i * 4 + 2] = src[i * 3 + 2];
      out[i * 4 + 3] = 65535;
    }
  } else if (channels === 1) {
    for (let i = 0; i < px; i++) {
      const v = src[i];
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 65535;
    }
  } else {
    throw new Error(`decodePng16: unsupported channel count ${channels}`);
  }
  return { data: out, width, height };
}
