const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

export async function downscaleForUpload(source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  const sourceWidth = 'width' in source ? source.width : 0;
  const sourceHeight = 'height' in source ? source.height : 0;
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
