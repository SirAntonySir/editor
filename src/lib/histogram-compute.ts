/**
 * Compute R/G/B/luma 256-bin histograms from any canvas-like source.
 *
 * Samples up to 256×256 pixels (downsampled internally) so the cost is
 * fixed regardless of source dimensions — fine for the inspector chrome
 * which only needs the shape, not pixel-accurate counts.
 */

export interface HistogramBins {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  lum: Uint32Array;
}

export function computeHistogramBins(
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap,
): HistogramBins | null {
  const w = 'width' in source ? source.width : 0;
  const h = 'height' in source ? source.height : 0;
  if (w === 0 || h === 0) return null;

  const sampleW = Math.min(w, 256);
  const sampleH = Math.min(h, 256);
  const sampleCanvas = new OffscreenCanvas(sampleW, sampleH);
  const sampleCtx = sampleCanvas.getContext('2d');
  if (!sampleCtx) return null;
  sampleCtx.drawImage(source as CanvasImageSource, 0, 0, sampleW, sampleH);

  const { data } = sampleCtx.getImageData(0, 0, sampleW, sampleH);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const lum = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    const l = Math.round(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
    lum[l]++;
  }
  return { r, g, b, lum };
}

/** Max bin count across all four channels, ignoring the two clamped edges
 *  (0 and 255) which usually dwarf interior counts on clipped images. */
export function histogramPeak(bins: HistogramBins): number {
  let max = 0;
  for (let i = 1; i < 255; i++) {
    max = Math.max(max, bins.lum[i], bins.r[i], bins.g[i], bins.b[i]);
  }
  return max;
}
