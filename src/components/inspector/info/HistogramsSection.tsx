import { BarChart3 } from 'lucide-react';
import type { EnrichedImageContext } from '@/types/enriched-context';
import { Histogram, type HistogramSeries } from '@/components/ui/Histogram';
import { PercentBar } from '@/components/ui/PercentBar';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: EnrichedImageContext;
}

export function HistogramsSection({ ctx }: Props) {
  // Photoshop-style stack: R / G / B as filled translucent areas (they
  // overlap-darken on the light surface, giving the high-contrast banded look
  // you get in the Levels tool), with luma painted last on top for an overall
  // shape silhouette. Bins are pre-binned by the backend so we just feed them
  // through.
  const series: HistogramSeries[] = [];
  if (ctx.rgb_histograms.r) series.push({ bins: ctx.rgb_histograms.r, color: 'rgba(255, 68, 68, 0.35)', fill: true });
  if (ctx.rgb_histograms.g) series.push({ bins: ctx.rgb_histograms.g, color: 'rgba(68, 187, 68, 0.35)', fill: true });
  if (ctx.rgb_histograms.b) series.push({ bins: ctx.rgb_histograms.b, color: 'rgba(68, 136, 255, 0.35)', fill: true });
  series.push({ bins: ctx.luma_histogram, color: 'rgba(120, 120, 120, 0.45)', fill: true });

  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={BarChart3} label="Histograms" />
      <div className="mb-2 rounded-[3px] bg-surface-secondary p-1.5 border border-separator">
        <Histogram series={series} height={68} />
      </div>
      <div className="flex flex-col gap-1 mb-1.5">
        <PercentBar pct={ctx.clipped_shadows_pct} color="#3b82f6" label="Clipped shadows" />
        <PercentBar pct={ctx.clipped_highlights_pct} color="#f59e0b" label="Clipped highlights" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-[10px] text-text-secondary">Median luma</dt>
        <dd className="text-[10px] text-text-primary text-right tabular-nums">{ctx.median_luma.toFixed(1)}</dd>
        <dt className="text-[10px] text-text-secondary">Contrast p10–p90</dt>
        <dd className="text-[10px] text-text-primary text-right tabular-nums">{ctx.contrast_p10_p90.toFixed(1)}</dd>
      </dl>
    </section>
  );
}
