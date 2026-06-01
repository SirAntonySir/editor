import type { HistogramBins } from '@/lib/histogram-compute';

interface Props {
  /** Pre-binned data (256 entries per channel). The Info tab feeds this
   *  from the backend's `image_context.luma_histogram + rgb_histograms`;
   *  the Levels control feeds it from a live canvas via
   *  `computeHistogramBins`. */
  bins: HistogramBins | null;
  /** Filled-area opacity for each channel. Defaults match the Levels look
   *  (R/G/B at 0.35, luma overlay at 0.45). */
  channelAlpha?: number;
  lumaAlpha?: number;
  /** ViewBox height; the rendered SVG always stretches to fill its
   *  container width (`width="100%" preserveAspectRatio="none"`). */
  viewBoxHeight?: number;
  className?: string;
}

/**
 * Read-only histogram plot — luma + R/G/B as filled translucent paths
 * stacked into the photoshop-style "darker overlap zones" look. Used by:
 *   - `HistogramsSection` (Info tab, pre-binned data from backend)
 *   - `LevelsHistogramControl` (Levels widget, computed live from canvas)
 *
 * The component is intentionally non-interactive — overlays like
 * draggable handles, clipped-zone tints, etc. are rendered by the
 * caller on top of this plot.
 */
export function HistogramPlot({
  bins,
  channelAlpha = 0.35,
  lumaAlpha = 0.45,
  viewBoxHeight = 100,
  className = '',
}: Props) {
  // Peak across channels (ignoring the two clamped edges) — keeps the
  // chart from being dominated by 0 / 255 spikes on clipped images.
  let peak = 0;
  if (bins) {
    for (let i = 1; i < 255; i++) {
      const a = bins.lum[i];
      const b = bins.r[i];
      const c = bins.g[i];
      const d = bins.b[i];
      if (a > peak) peak = a;
      if (b > peak) peak = b;
      if (c > peak) peak = c;
      if (d > peak) peak = d;
    }
  }

  const buildPath = (ch: Uint32Array | number[]): string => {
    if (peak === 0) return '';
    const h = viewBoxHeight;
    const parts: string[] = [`M0,${h}`];
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 256;
      const y = h - Math.min(h, (ch[i] / peak) * h);
      parts.push(`L${x},${y}`);
    }
    parts.push(`L256,${h}`, 'Z');
    return parts.join(' ');
  };

  return (
    <svg
      viewBox={`0 0 256 ${viewBoxHeight}`}
      preserveAspectRatio="none"
      width="100%"
      height={viewBoxHeight}
      className={className}
      aria-hidden
    >
      {bins && peak > 0 && (
        <>
          <path d={buildPath(bins.r)} fill={`rgba(255, 68, 68, ${channelAlpha})`} />
          <path d={buildPath(bins.g)} fill={`rgba(68, 187, 68, ${channelAlpha})`} />
          <path d={buildPath(bins.b)} fill={`rgba(68, 136, 255, ${channelAlpha})`} />
          <path d={buildPath(bins.lum)} fill={`rgba(120, 120, 120, ${lumaAlpha})`} />
        </>
      )}
    </svg>
  );
}
