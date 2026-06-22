/**
 * Decode a base64 PNG via an HTMLImageElement. More permissive across browsers
 * than `createImageBitmap` for some edge-case PNG payloads (e.g. mode "L"
 * single-channel PNGs).
 */
function decodeViaImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decodeViaImage: <img> failed to load PNG'));
    img.src = dataUrl;
  });
}

export async function maskPngBase64ToBytes(
  pngBase64: string,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const cleaned = pngBase64.replace(/\s+/g, '');
  if (!cleaned.startsWith('iVBORw0KGgo')) {
    console.warn('[maskPngBase64ToBytes] base64 does not start with PNG signature', cleaned.slice(0, 16));
  }
  const dataUrl = `data:image/png;base64,${cleaned}`;

  // Try createImageBitmap first; fall back to <img> if it produces a 0×0
  // bitmap (some browsers silently fail rather than throw on mode-L PNGs).
  let width = 0;
  let height = 0;
  let drawSource: ImageBitmap | HTMLImageElement | null = null;
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width > 0 && bitmap.height > 0) {
      drawSource = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } else {
      console.warn('[maskPngBase64ToBytes] createImageBitmap returned 0×0, falling back to <img>');
      bitmap.close();
    }
  } catch (err) {
    console.warn('[maskPngBase64ToBytes] createImageBitmap threw, falling back to <img>:', err);
  }

  if (!drawSource) {
    const img = await decodeViaImage(dataUrl);
    width = img.naturalWidth;
    height = img.naturalHeight;
    drawSource = img;
  }

  if (width === 0 || height === 0) {
    if (drawSource instanceof ImageBitmap) drawSource.close();
    throw new Error(`maskPngBase64ToBytes: decoded image is 0×0 (input ${cleaned.length} chars)`);
  }

  const tmp = new OffscreenCanvas(width, height);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('maskPngBase64ToBytes: no 2d context');
  ctx.drawImage(drawSource, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height);
  const out = maskAlphaFromRgba(imgData.data, width * height);
  if (drawSource instanceof ImageBitmap) drawSource.close();
  return { data: out, width, height };
}

/**
 * Reduce decoded RGBA pixel bytes to a single-channel mask-alpha array.
 *
 * The backend can return a mask in either of two shapes:
 *   (a) 1-channel grayscale PNG — decodes to RGBA with R=G=B carrying the
 *       shape and alpha pinned at 255 (object = 255 white, bg = 0 black).
 *   (b) RGBA where the shape lives in the ALPHA channel over fully-opaque
 *       white RGB — what SAM / PIL emits when saving with `mode='RGBA'`.
 *
 * Reading only red works for (a) but in (b) every red byte is 255 → a
 * fully-opaque mask → `extractLayerFromMask`'s `destination-in` keeps every
 * pixel and the "extracted object" is a verbatim copy of the source image.
 *
 * Two-pass: first scan determines which channel actually carries variance —
 * if red is constantly opaque AND alpha varies, the shape is in alpha;
 * otherwise read red. This handles both shapes without a backend contract
 * change.
 */
export function maskAlphaFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): Uint8Array {
  let redOpaque = 0;
  let aMin = 255;
  let aMax = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4];
    const a = rgba[i * 4 + 3];
    if (r === 255) redOpaque++;
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
  }
  // Shape-in-alpha when red is uniformly opaque (>99% to ignore JPEG-ish
  // anti-alias drift) AND alpha actually varies across the frame. Otherwise
  // fall back to red, which handles both grayscale-mode and a degenerate
  // all-foreground alpha frame.
  const useAlpha = pixelCount > 0 && redOpaque / pixelCount > 0.99 && aMax - aMin > 0;
  const channelOffset = useAlpha ? 3 : 0;
  const out = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) out[i] = rgba[i * 4 + channelOffset];
  return out;
}
