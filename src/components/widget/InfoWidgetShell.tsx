import { Info as InfoIcon, Sparkles, Copy as CopyIcon } from 'lucide-react';
import { useEditorStore } from '@/store';
import type { InfoNodeState, InfoHistogramPayload, InfoNodeContent } from '@/types/workspace';
import { MetricChip, MetricChipGrid } from '@/components/inspector/info/MetricChip';
import { HistogramPlot } from '@/components/ui/HistogramPlot';
import type { HistogramBins } from '@/lib/histogram-compute';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { resolveSourceValue, type LiveSources } from '@/lib/info-source-resolver';

interface Props {
  node: InfoNodeState;
}

/**
 * Canvas-side shell for a frontend-only info widget. Body content is
 * dispatched on `node.content.kind`:
 *
 *   - 'stats'     → chip grid (same primitive used in the Info tab)
 *   - 'histogram' → frozen HistogramPlot
 *   - 'palette'   → swatch bar
 *   - 'cast'      → 2D Lab a-star / b-star plot
 *
 * Chrome (header / footer) is shared so every kind reads as the same
 * widget species on the canvas.
 */
export function InfoWidgetShell({ node }: Props) {
  const removeInfoNode = useEditorStore((s) => s.removeInfoNode);
  // Live sources — info widgets MIRROR the current state of these on every
  // render rather than freezing the snapshot at pin time. The stored
  // `node.content` only acts as a fallback when the live source is
  // unavailable (no image, mechanical not yet computed).
  const mech = useLiveMechanicalContext();
  const documentMeta = useEditorStore((s) => s.documentMeta);
  const live: LiveSources = { mech, documentMeta };

  // Project the stored content over the live sources. Each kind decides
  // independently whether to overlay live data or fall back.
  const liveContent = projectLive(node.content, live);
  const title = node.title ?? defaultTitleFor(liveContent.kind);

  async function copyAll() {
    const text = contentToClipboardText(liveContent);
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  }

  function askAi() {
    // Open Cmd+K with the items pre-attached as context. The Cmd+K open
    // handler reads `detail.attachContext` and seeds the attached set.
    window.dispatchEvent(new CustomEvent('spawn-palette:open', {
      detail: { attachContext: contentToContextItems(liveContent) },
    }));
  }

  return (
    <div className="overlay w-fit" style={{ minWidth: node.size.w }}>
      <Header title={title} count={contentCount(liveContent)} onClose={() => removeInfoNode(node.id)} />
      <div className="px-1.5 py-1.5">
        <Body content={liveContent} />
      </div>
      <Footer onAskAi={askAi} onCopy={copyAll} />
    </div>
  );
}

/** Project the stored content over the live sources. For each kind we
 *  prefer live data; the stored snapshot only shows through when its
 *  live source is unavailable. */
function projectLive(content: InfoNodeContent, live: LiveSources): InfoNodeContent {
  switch (content.kind) {
    case 'stats':
      return {
        kind: 'stats',
        // Resolve every item's `sourceId` to a current value. Items without
        // a sourceId (or with unresolvable ones — e.g. AI-derived context
        // that's been cleared) keep their stored value.
        items: content.items.map((item) => {
          const liveValue = item.sourceId ? resolveSourceValue(item.sourceId, live) : undefined;
          return liveValue !== undefined ? { ...item, value: liveValue } : item;
        }),
      };
    case 'histogram':
      if (!live.mech) return content;
      return {
        kind: 'histogram',
        bins: {
          r:   live.mech.rgbHistograms.r,
          g:   live.mech.rgbHistograms.g,
          b:   live.mech.rgbHistograms.b,
          lum: live.mech.lumaHistogram,
        },
      };
    case 'palette':
      if (!live.mech || live.mech.colorPalette.length === 0) return content;
      return {
        kind: 'palette',
        palette: {
          swatches: live.mech.colorPalette.map((s) => ({
            rgb: s.rgb,
            weight: s.weight,
          })),
        },
      };
    case 'cast':
      if (!live.mech) return content;
      return {
        kind: 'cast',
        cast: {
          a: live.mech.castDirection[0],
          b: live.mech.castDirection[1],
          strength: live.mech.castStrength,
        },
      };
  }
}

// ─── Header / Footer (shared chrome) ─────────────────────────────────

function Header({
  title, count, onClose,
}: {
  title: string;
  count?: number;
  onClose: () => void;
}) {
  return (
    <div
      className="workspace-drag-handle flex items-center gap-1.5 px-1.5 py-1
        cursor-grab active:cursor-grabbing select-none"
      role="button"
      aria-label="Info widget header"
    >
      <span className="grip flex flex-col gap-px pr-1 opacity-55" aria-hidden>
        {[0, 1, 2].map((r) => (
          <span key={r} className="flex gap-px">
            <i className="w-[2px] h-[2px] rounded-full bg-text-secondary" />
            <i className="w-[2px] h-[2px] rounded-full bg-text-secondary" />
          </span>
        ))}
      </span>
      <InfoIcon size={12} className="shrink-0 text-text-secondary" aria-hidden />
      <span className="text-[11px] font-medium flex-1 min-w-0 truncate text-text-primary">{title}</span>
      {count !== undefined && (
        <span className="text-[9px] text-text-secondary bg-surface-secondary
          border border-separator rounded-[3px] px-1.5 py-px leading-[1.4] tabular-nums">
          {count}
        </span>
      )}
      <button
        type="button"
        aria-label="Remove info widget"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="text-text-secondary hover:text-text-primary text-[13px] leading-none px-0.5"
      >×</button>
    </div>
  );
}

function Footer({ onAskAi, onCopy }: { onAskAi: () => void; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-px px-1.5 pt-1 pb-1.5 border-t border-separator">
      <button
        type="button"
        onClick={onAskAi}
        className="inline-flex items-center gap-1 text-[9px] text-[var(--color-ai)]
          hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
      >
        <Sparkles size={10} aria-hidden /> Ask about this
      </button>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 text-[9px] text-text-secondary
          hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
        title="Copy values"
      >
        <CopyIcon size={10} aria-hidden /> Copy
      </button>
    </div>
  );
}

// ─── Body dispatcher ─────────────────────────────────────────────────

function Body({ content }: { content: InfoNodeState['content'] }) {
  switch (content.kind) {
    case 'stats':
      if (content.items.length === 0) {
        return <div className="text-[10px] text-text-secondary px-1 py-1.5">No items pinned yet.</div>;
      }
      return (
        <MetricChipGrid>
          {content.items.map((item) => (
            <MetricChip key={item.id} label={item.label} value={item.value} />
          ))}
        </MetricChipGrid>
      );
    case 'histogram': {
      // Project the stored number[] arrays into the Uint32Array shape
      // HistogramPlot wants. Memoising isn't worth it — payloads are
      // tiny (≤ 4 × 256 numbers) and the widget rarely re-renders.
      const bins = histPayloadToBins(content.bins);
      return (
        <div className="rounded-[3px] bg-surface-secondary p-1.5 border border-separator">
          <HistogramPlot bins={bins} viewBoxHeight={80} />
        </div>
      );
    }
    case 'palette':
      return (
        <div className="flex h-6 rounded-[3px] overflow-hidden border border-separator">
          {content.palette.swatches.map((s, i) => (
            <div
              key={i}
              style={{
                flexGrow: Math.max(s.weight, 0.02),
                minWidth: 6,
                backgroundColor: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`,
              }}
              title={`#${hex(s.rgb[0])}${hex(s.rgb[1])}${hex(s.rgb[2])} · ${(s.weight * 100).toFixed(0)}%`}
            />
          ))}
        </div>
      );
    case 'cast':
      return <CastPlot a={content.cast.a} b={content.cast.b} strength={content.cast.strength} />;
  }
}

// ─── Cast 2D plot — same visualisation the Info tab uses, slimmed ────

const CAST_AB_RANGE = 50;
const CAST_BOX_PX = 88;

function CastPlot({ a, b, strength }: { a: number; b: number; strength: number }) {
  const ca = Math.max(-CAST_AB_RANGE, Math.min(CAST_AB_RANGE, a));
  const cb = Math.max(-CAST_AB_RANGE, Math.min(CAST_AB_RANGE, b));
  const x = ((ca + CAST_AB_RANGE) / (2 * CAST_AB_RANGE)) * CAST_BOX_PX;
  const y = ((cb + CAST_AB_RANGE) / (2 * CAST_AB_RANGE)) * CAST_BOX_PX;
  return (
    <div className="flex items-stretch gap-3">
      <div
        className="relative flex-none bg-surface-secondary rounded-[3px] border border-separator"
        style={{ width: CAST_BOX_PX, height: CAST_BOX_PX }}
      >
        <div className="absolute top-1/2 left-0 right-0 h-px bg-separator" />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-separator" />
        <div
          className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-accent shadow-sm"
          style={{ left: x, top: y, opacity: Math.min(1, 0.4 + strength * 0.6) }}
        />
      </div>
      <dl className="flex-1 min-w-0 grid grid-cols-[auto_1fr] auto-rows-min content-center
        gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
        <dt className="text-text-secondary">a*</dt>
        <dd className="text-text-primary text-right">{ca.toFixed(1)}</dd>
        <dt className="text-text-secondary">b*</dt>
        <dd className="text-text-primary text-right">{cb.toFixed(1)}</dd>
        <dt className="text-text-secondary">strength</dt>
        <dd className="text-text-primary text-right">{(strength * 100).toFixed(0)}%</dd>
      </dl>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function defaultTitleFor(kind: InfoNodeState['content']['kind']): string {
  switch (kind) {
    case 'stats':     return 'Stats';
    case 'histogram': return 'Histogram';
    case 'palette':   return 'Palette';
    case 'cast':      return 'Color cast';
  }
}

function contentCount(content: InfoNodeContent): number | undefined {
  switch (content.kind) {
    case 'stats':   return content.items.length;
    case 'palette': return content.palette.swatches.length;
    default:        return undefined;
  }
}

function contentToContextItems(content: InfoNodeContent): { label: string; value: string; sourceId?: string }[] {
  switch (content.kind) {
    case 'stats':
      return content.items.map((i) => ({ label: i.label, value: i.value, sourceId: i.sourceId }));
    case 'cast':
      return [{ label: 'Color cast', value: `a*=${content.cast.a.toFixed(1)}, b*=${content.cast.b.toFixed(1)}, strength=${(content.cast.strength * 100).toFixed(0)}%`, sourceId: 'mech:cast' }];
    case 'palette': {
      const top = content.palette.swatches
        .slice(0, 5)
        .map((s) => `#${hex(s.rgb[0])}${hex(s.rgb[1])}${hex(s.rgb[2])}`)
        .join(' ');
      return [{ label: 'Palette', value: top, sourceId: 'mech:palette' }];
    }
    case 'histogram': {
      // Compress to compact descriptors for the LLM. The full bins array
      // would be too noisy.
      const lum = content.bins.lum;
      let total = 0;
      let weighted = 0;
      for (let i = 0; i < lum.length; i++) { total += lum[i]; weighted += i * lum[i]; }
      const mean = total > 0 ? Math.round(weighted / total) : 0;
      return [{ label: 'Histogram', value: `mean luma ≈ ${mean}`, sourceId: 'mech:histogram' }];
    }
  }
}

function contentToClipboardText(content: InfoNodeContent): string {
  switch (content.kind) {
    case 'stats':
      return content.items.map((i) => `${i.label}: ${i.value}`).join('\n');
    case 'cast':
      return `a*=${content.cast.a.toFixed(1)}, b*=${content.cast.b.toFixed(1)}, strength=${(content.cast.strength * 100).toFixed(0)}%`;
    case 'palette':
      return content.palette.swatches
        .map((s) => `#${hex(s.rgb[0])}${hex(s.rgb[1])}${hex(s.rgb[2])} (${(s.weight * 100).toFixed(0)}%)`)
        .join('\n');
    case 'histogram':
      return `Luma bins: [${content.bins.lum.join(',')}]`;
  }
}

function histPayloadToBins(p: InfoHistogramPayload): HistogramBins | null {
  if (!p.lum || p.lum.length === 0) return null;
  const zero = (): Uint32Array => new Uint32Array(256);
  const fromArr = (arr: number[] | undefined): Uint32Array => {
    if (!arr) return zero();
    const out = new Uint32Array(256);
    for (let i = 0; i < Math.min(256, arr.length); i++) out[i] = arr[i] | 0;
    return out;
  };
  return { r: fromArr(p.r), g: fromArr(p.g), b: fromArr(p.b), lum: fromArr(p.lum) };
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
