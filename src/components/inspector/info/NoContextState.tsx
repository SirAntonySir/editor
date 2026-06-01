import { useState } from 'react';
import { Sparkles, Tag, BarChart3, Palette, MapPin } from 'lucide-react';
import { useEditorStore } from '@/store';
import { analyseFirstImageLayer } from '@/hooks/useImageContext';

/**
 * Info-tab empty state. Splits into two halves:
 *   - Top: a bare violet sparkles icon + CTA. Pulses gently to read as
 *     "alive and waiting for one click".
 *   - Bottom: a shimmering mock preview of the future info-tab sections
 *     (semantic chips, histogram, palette, regions) so the user sees what
 *     analysis will produce. The shimmer cues the inert state.
 *
 * Analysis bootstraps the backend session/SSE itself, so the CTA only gates
 * on having an image layer loaded — not on an already-open SSE.
 */
export function NoContextState() {
  const hasImage = useEditorStore((s) => s.layers.some((l) => l.type === 'image'));
  const [busy, setBusy] = useState(false);

  const disabled = busy || !hasImage;
  const hint = !hasImage ? 'Open an image to analyze.' : null;

  async function run() {
    if (disabled) return;
    setBusy(true);
    try {
      await analyseFirstImageLayer();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      {/* Hero */}
      <div className="px-4 pt-6 pb-5 flex flex-col items-center gap-2.5 text-center">
        <Sparkles
          size={28}
          className="text-ai ai-glow-pulse"
          aria-hidden
        />
        <h2 className="text-[13px] font-semibold text-text-primary">
          Analyze this image
        </h2>
        <p className="text-[11px] leading-snug text-text-secondary max-w-[230px]">
          Let AI read this image — semantic regions, histograms, palette,
          and suggested adjustments — in a few seconds.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={disabled}
          className="mt-1 inline-flex items-center gap-1.5 rounded-[var(--radius-button)]
            px-3.5 py-1.5 text-[11px] font-medium text-white
            bg-ai hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-50
            shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-ai)_35%,transparent),0_0_12px_2px_color-mix(in_srgb,var(--color-ai)_28%,transparent)]"
        >
          <Sparkles size={12} aria-hidden />
          {busy ? 'Analyzing…' : 'Analyze with AI'}
        </button>
        {hint && <span className="text-[10px] text-text-secondary">{hint}</span>}
      </div>

      {/* Mock preview — same section rhythm as the real Info tab.
          opacity-60 + pointer-events-none so the user knows it's a placeholder. */}
      <div className="opacity-60 pointer-events-none select-none border-t border-separator">
        <MockSection icon={Tag} label="Semantic">
          <div className="flex flex-wrap gap-1 mb-1.5">
            <MockChip width={64} />
            <MockChip width={48} />
            <MockChip width={56} />
            <MockChip width={40} />
          </div>
          <MockRow />
          <MockRow />
          <MockRow />
        </MockSection>

        <MockSection icon={BarChart3} label="Histograms">
          <div className="rounded-[3px] bg-surface-secondary p-1.5 border border-separator h-[68px] ai-shimmer" />
          <div className="flex flex-col gap-1 mt-2">
            <MockBar />
            <MockBar />
          </div>
        </MockSection>

        <MockSection icon={Palette} label="Color">
          <div className="flex h-5 mb-2 rounded-[3px] overflow-hidden border border-separator">
            {[15, 22, 18, 12, 14, 10, 9].map((w, i) => (
              <div
                key={i}
                style={{ flexGrow: w }}
                className="bg-surface-secondary ai-shimmer"
              />
            ))}
          </div>
          <MockRow />
          <MockRow />
        </MockSection>

        <MockSection icon={MapPin} label="Regions">
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2 items-center py-0.5">
                <div className="w-9 h-9 rounded-[3px] bg-surface-secondary ai-shimmer" />
                <div className="flex-1 min-w-0">
                  <MockLine width="40%" />
                  <MockLine width="70%" muted />
                </div>
              </div>
            ))}
          </div>
        </MockSection>
      </div>
    </div>
  );
}

// ─── Mock atoms ─────────────────────────────────────────────────────

function MockSection({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 py-2.5 border-b border-separator last:border-b-0">
      <div className="flex items-center gap-1.5 mb-2 text-text-secondary">
        <Icon size={11} className="opacity-60" />
        <span className="text-[9px] uppercase tracking-[0.08em] font-medium">{label}</span>
        <span className="flex-1 h-px bg-separator" aria-hidden />
      </div>
      {children}
    </section>
  );
}

function MockChip({ width }: { width: number }) {
  return (
    <span
      style={{ width }}
      className="h-[18px] rounded-[3px] bg-surface-secondary ai-shimmer"
    />
  );
}

function MockRow() {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mb-1">
      <span className="w-12 h-2.5 rounded-sm bg-surface-secondary ai-shimmer" />
      <span className="justify-self-end w-16 h-2.5 rounded-sm bg-surface-secondary ai-shimmer" />
    </div>
  );
}

function MockBar() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2.5 rounded-sm bg-surface-secondary ai-shimmer" />
      <div className="flex-1 h-2 rounded-full bg-surface-secondary ai-shimmer" />
      <div className="w-8 h-2.5 rounded-sm bg-surface-secondary ai-shimmer" />
    </div>
  );
}

function MockLine({ width, muted }: { width: string; muted?: boolean }) {
  return (
    <div
      style={{ width }}
      className={`h-2.5 rounded-sm bg-surface-secondary ai-shimmer ${muted ? 'opacity-70' : ''} mb-1 last:mb-0`}
    />
  );
}
