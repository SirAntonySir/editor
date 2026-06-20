import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useEditorStore } from '@/store';
import { analyseActiveImageLayer } from '@/hooks/useImageContext';

interface Props {
  /** True once analyze has been kicked off but no context delta has arrived
   *  yet. The CTA shows a small spinner; once the first delta lands the
   *  overlay disappears entirely (caller toggles its visibility). */
  analyzing: boolean;
}

/**
 * Floating overlay rendered ON TOP of the Info-tab skeleton background.
 * Shows hero copy + an "Analyze with AI" CTA. Once analyze runs and the
 * first context delta lands, the parent unmounts this overlay — from there
 * the individual section skeletons themselves communicate remaining
 * progress (each flips to real data as its delta arrives). No stepper.
 */
export function NoContextState({ analyzing }: Props) {
  const hasImage = useEditorStore((s) => s.layers.some((l) => l.type === 'image'));
  const [busy, setBusy] = useState(false);

  const inFlight = busy || analyzing;
  const disabled = inFlight || !hasImage;
  const hint = !hasImage ? 'Open an image to analyze.' : null;

  async function run() {
    if (disabled) return;
    setBusy(true);
    try {
      await analyseActiveImageLayer();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {/* Backdrop: full-bleed, no margin. Vertical gradient is most opaque
          near the top where the hero text lives and fades to nearly clear
          near the bottom, so the structural skeleton stays visible through
          the lower regions. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
            to bottom,
            color-mix(in srgb, var(--color-surface) 94%, transparent) 0%,
            color-mix(in srgb, var(--color-surface) 86%, transparent) 18%,
            color-mix(in srgb, var(--color-surface) 55%, transparent) 50%,
            color-mix(in srgb, var(--color-surface) 18%, transparent) 80%,
            color-mix(in srgb, var(--color-surface) 8%, transparent) 100%
          )`,
          backdropFilter: 'blur(0.5px)',
        }}
        aria-hidden
      />
      {/* Hero content. No card chrome — just text on the backdrop.
          `pointer-events-auto` opts the controls back in. */}
      <div className="relative pointer-events-auto flex flex-col items-center gap-2.5 px-4 pt-8 pb-4 text-center">
        <Sparkles size={28} className="text-ai ai-glow-pulse" aria-hidden />
        <h2 className="text-[13px] font-semibold text-text-primary">
          Analyze this image
        </h2>
        <p className="text-[11px] leading-snug text-text-secondary max-w-[220px]">
          Let AI read this image — semantic regions, histograms, palette, and
          suggested adjustments — sections will fill in as data arrives.
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
          {inFlight ? (
            <Loader2 size={12} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={12} aria-hidden />
          )}
          {inFlight ? 'Analyzing…' : 'Analyze with AI'}
        </button>
        {hint && <span className="text-[10px] text-text-secondary">{hint}</span>}
      </div>
    </div>
  );
}
