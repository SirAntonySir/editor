const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

export async function downscaleForUpload(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  const sourceWidth = 'width' in source ? source.width : 0;
  const sourceHeight = 'height' in source ? source.height : 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    // Without this guard, `MAX_EDGE / Math.max(0, 0) === Infinity`,
    // we'd clamp to scale=1, build a 0×0 canvas, and `convertToBlob`
    // would either throw or return an unusable blob depending on the
    // browser.
    throw new Error(`downscaleForUpload: invalid source dimensions ${sourceWidth}x${sourceHeight}`);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
