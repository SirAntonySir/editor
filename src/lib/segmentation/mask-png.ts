import type { DecodedMask } from './mobile-sam-types';

/** Encode a DecodedMask (grayscale Uint8Array of 0/255) as a base64 PNG.
 *  Used by the Objects-Mode commit path to ship the client-generated mask
 *  to the backend's `propose_mask` tool. Lives in its own module so tests
 *  can mock it without polyfilling OffscreenCanvas in jsdom. */
export async function maskToPngBase64(mask: DecodedMask): Promise<string> {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  const imgData = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i];
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
