import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { EnrichedImageContext } from '@/types/enriched-context';
import { HistogramPlot } from '@/components/ui/HistogramPlot';
import type { HistogramBins } from '@/lib/histogram-compute';
import { PercentBar } from '@/components/ui/PercentBar';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: EnrichedImageContext;
}

/** Convert the backend's number-array histogram payloads into the
 *  Uint32Array-shaped `HistogramBins` the shared `HistogramPlot`
 *  consumes. Missing channels default to a 256-element zero array — the
 *  plot then renders just the channels that ARE populated. */
function binsFromContext(ctx: EnrichedImageContext): HistogramBins | null {
  if (!ctx.luma_histogram || ctx.luma_histogram.length === 0) return null;
  const zero = (): Uint32Array => new Uint32Array(256);
  const fromArr = (arr: number[] | undefined): Uint32Array => {
    if (!arr) return zero();
    const out = new Uint32Array(256);
    for (let i = 0; i < Math.min(256, arr.length); i++) out[i] = arr[i] | 0;
    return out;
  };
  return {
    r: fromArr(ctx.rgb_histograms.r),
    g: fromArr(ctx.rgb_histograms.g),
    b: fromArr(ctx.rgb_histograms.b),
    lum: fromArr(ctx.luma_histogram),
  };
}

export function HistogramsSection({ ctx }: Props) {
  // Memoise the Uint32Array conversion — recomputes only when the context
  // actually changes, not on every parent re-render.
  const bins = useMemo(() => binsFromContext(ctx), [ctx]);

  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={BarChart3} label="Histograms" />
      <div className="mb-2 rounded-[3px] bg-surface-secondary p-1.5 border border-separator">
        <HistogramPlot bins={bins} viewBoxHeight={68} />
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
