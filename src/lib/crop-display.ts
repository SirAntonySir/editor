/**
 * Crop display/export utility.
 *
 * Renders a cropped+rotated+flipped sub-region from a source canvas.
 * Used by both useAdjustmentPipeline (display preview) and export,
 * so the preview always matches the exported result exactly.
 *
 * Source pixels in PixelStore are NEVER modified — this is a pure
 * read-only rendering operation.
 */

import type { CropMeta } from '@/store/layer-slice';

/**
 * Apply CropMeta to a canvas, producing a new OffscreenCanvas with
 * only the cropped (and optionally rotated/flipped) region.
 */
export function applyCropForExport(
  source: HTMLCanvasElement | OffscreenCanvas,
  cropMeta: CropMeta,
): OffscreenCanvas {
  const srcW = source.width;
  const srcH = source.height;
  const px = Math.round(cropMeta.rx * srcW);
  const py = Math.round(cropMeta.ry * srcH);
  const pw = Math.round(cropMeta.rw * srcW);
  const ph = Math.round(cropMeta.rh * srcH);
  const totalAngle = cropMeta.baseRotation + cropMeta.straighten;

  const out = new OffscreenCanvas(Math.max(pw, 1), Math.max(ph, 1));
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  if (totalAngle !== 0 || cropMeta.flipX || cropMeta.flipY) {
    ctx.save();
    ctx.translate(pw / 2, ph / 2);
    if (totalAngle !== 0) ctx.rotate((-totalAngle * Math.PI) / 180);
    if (cropMeta.flipX) ctx.scale(-1, 1);
    if (cropMeta.flipY) ctx.scale(1, -1);
    ctx.drawImage(source, -(px + pw / 2), -(py + ph / 2));
    ctx.restore();
  } else {
    ctx.drawImage(source, px, py, pw, ph, 0, 0, pw, ph);
  }

  return out;
}
