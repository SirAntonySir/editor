import { useMemo } from 'react';
import { BarChart3, Pin } from 'lucide-react';
import type { ImageContext } from '@/types/image-context';
import { HistogramPlot } from '@/components/ui/HistogramPlot';
import type { HistogramBins } from '@/lib/histogram-compute';
import { SectionHeader } from './SectionHeader';
import { MetricChipGrid } from '@/components/ui/MetricChip';
import { MetricChipMenu } from './MetricChipMenu';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';

interface Props {
  ctx: ImageContext;
}

/** Convert the backend's number-array histogram payloads into the
 *  Uint32Array-shaped `HistogramBins` the shared `HistogramPlot`
 *  consumes. Missing channels default to a 256-element zero array — the
 *  plot then renders just the channels that ARE populated. */
function binsFromContext(ctx: ImageContext): HistogramBins | null {
  if (!ctx.lumaHistogram || ctx.lumaHistogram.length === 0) return null;
  const zero = (): Uint32Array => new Uint32Array(256);
  const fromArr = (arr: number[] | undefined): Uint32Array => {
    if (!arr) return zero();
    const out = new Uint32Array(256);
    for (let i = 0; i < Math.min(256, arr.length); i++) out[i] = arr[i] | 0;
    return out;
  };
  return {
    r: fromArr(ctx.rgbHistograms?.['r']),
    g: fromArr(ctx.rgbHistograms?.['g']),
    b: fromArr(ctx.rgbHistograms?.['b']),
    lum: fromArr(ctx.lumaHistogram),
  };
}

export function HistogramsSection({ ctx }: Props) {
  // Memoise the Uint32Array conversion — recomputes only when the context
  // actually changes, not on every parent re-render.
  const bins = useMemo(() => binsFromContext(ctx), [ctx]);

  // Build the tone-chips list. Each entry only renders when its source
  // is a finite number — keeps the "no empty states" promise even when
  // the backend / live-mechanical pass emits a partial snapshot.
  type Chip = { sourceId: string; label: string; value: string };
  const chips: Chip[] = [];
  const push = (sourceId: string, label: string, value: string | undefined) => {
    if (value !== undefined) chips.push({ sourceId, label, value });
  };
  push('mech:clipped_shadows',    'Clipped ▼', formatPct(ctx.clippedShadowsPct));
  push('mech:clipped_highlights', 'Clipped ▲', formatPct(ctx.clippedHighlightsPct));
  push('mech:median_luma',        'Median',    formatLuma(ctx.medianLuma));
  push('mech:contrast_p10_p90',   'Contrast',  formatLuma(ctx.contrastP10P90));

  // Items the "Pin section" button on the header passes to addInfoNode.
  // Built from the same chip list so the pinned widget mirrors what's shown.
  const pinnable = chips.map((c, i) => ({
    id: `pin-${c.sourceId}-${i}`,
    label: c.label, value: c.value, sourceId: c.sourceId,
  }));

  function pinHistogram() {
    if (!bins) return;
    const editor = useEditorStore.getState();
    const activeId = editor.activeImageNodeId;
    const node = activeId ? editor.imageNodes[activeId] : undefined;
    const position = node
      ? { x: node.position.x + node.size.w + 32, y: node.position.y }
      : { x: 200, y: 200 };
    editorDocument.workspace.addInfoNode(
      {
        kind: 'histogram',
        bins: {
          // Frozen at pin time: copy each channel array. HistogramBins are
          // Uint32Array under the hood; spread to plain number[] for the
          // SerializableState round-trip.
          r:   bins.r   ? Array.from(bins.r)   : undefined,
          g:   bins.g   ? Array.from(bins.g)   : undefined,
          b:   bins.b   ? Array.from(bins.b)   : undefined,
          lum: Array.from(bins.lum),
        },
      },
      { position, title: 'Histogram', targetImageNodeId: activeId ?? undefined },
    );
    toast.info('Pinned histogram');
  }

  return (
    <section className="px-3 py-2.5 flex flex-col gap-2">
      <SectionHeader icon={BarChart3} label="Histograms" pinnable={pinnable} />
      <div className="relative group rounded-[3px] bg-surface-secondary p-1.5 border border-separator">
        <HistogramPlot bins={bins} viewBoxHeight={68} />
        {bins && (
          <button
            type="button"
            onClick={pinHistogram}
            title="Pin histogram as canvas widget"
            aria-label="Pin histogram"
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100
              focus-visible:opacity-100 transition-opacity
              text-text-secondary hover:text-text-primary
              bg-surface/80 backdrop-blur-sm border border-separator
              rounded-[3px] p-0.5"
          >
            <Pin size={11} aria-hidden />
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <MetricChipGrid>
          {chips.map((c) => (
            <MetricChipMenu
              key={c.sourceId}
              sourceId={c.sourceId}
              label={c.label}
              value={c.value}
            />
          ))}
        </MetricChipGrid>
      )}
    </section>
  );
}

function formatPct(v: number | undefined): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return `${v.toFixed(1)}%`;
}

function formatLuma(v: number | undefined): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v.toFixed(0);
}
