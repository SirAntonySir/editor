import { BarChart3 } from 'lucide-react';
import type { EnrichedImageContext } from '@/types/enriched-context';
import { Histogram, type HistogramSeries } from '@/components/ui/Histogram';
import { PercentBar } from '@/components/ui/PercentBar';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: EnrichedImageContext;
}

export function HistogramsSection({ ctx }: Props) {
  // One combined chart: faint luma fill as a backdrop, R/G/B overlaid as
  // translucent stroked curves on a shared vertical scale.
  const series: HistogramSeries[] = [
    { bins: ctx.luma_histogram, color: 'rgba(115,115,115,0.18)', fill: true },
  ];
  if (ctx.rgb_histograms.r) series.push({ bins: ctx.rgb_histograms.r, color: 'rgba(239,68,68,0.8)', fill: false });
  if (ctx.rgb_histograms.g) series.push({ bins: ctx.rgb_histograms.g, color: 'rgba(34,197,94,0.8)', fill: false });
  if (ctx.rgb_histograms.b) series.push({ bins: ctx.rgb_histograms.b, color: 'rgba(59,130,246,0.8)', fill: false });

  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={BarChart3} label="Histograms" />
      <div className="mb-2 -mx-0.5 rounded-[3px] bg-surface-secondary/40 p-1">
        <Histogram series={series} width={228} height={56} />
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
