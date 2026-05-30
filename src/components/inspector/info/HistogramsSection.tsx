import type { EnrichedImageContext } from '@/types/enriched-context';
import { Histogram } from '@/components/ui/Histogram';
import { PercentBar } from '@/components/ui/PercentBar';

interface Props {
  ctx: EnrichedImageContext;
}

export function HistogramsSection({ ctx }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Histograms
      </div>
      <div className="flex flex-col gap-1 mb-2">
        <Histogram bins={ctx.luma_histogram} color="var(--color-text-secondary)" />
        {ctx.rgb_histograms.r && <Histogram bins={ctx.rgb_histograms.r} color="rgba(239,68,68,0.7)" />}
        {ctx.rgb_histograms.g && <Histogram bins={ctx.rgb_histograms.g} color="rgba(34,197,94,0.7)" />}
        {ctx.rgb_histograms.b && <Histogram bins={ctx.rgb_histograms.b} color="rgba(59,130,246,0.7)" />}
      </div>
      <div className="flex flex-col gap-1 mb-1.5">
        <PercentBar pct={ctx.clipped_shadows_pct} color="#3b82f6" label="Clipped shadows" />
        <PercentBar pct={ctx.clipped_highlights_pct} color="#f59e0b" label="Clipped highlights" />
      </div>
      <Row k="Median luma" v={ctx.median_luma.toFixed(2)} />
      <Row k="Contrast (p10–p90)" v={ctx.contrast_p10_p90.toFixed(2)} />
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[10px] mb-0.5">
      <span className="text-text-secondary">{k}</span>
      <span className="text-text-primary tabular-nums">{v}</span>
    </div>
  );
}
