import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useEditorStore } from '@/store';
import { analyseFirstImageLayer } from '@/hooks/useImageContext';
import { PhaseSteps } from '@/components/ui/PhaseSteps';
import type { PhaseMap } from '@/store/backend-state-slice';

interface Props {
  /** True once analyze has been kicked off and phases are running. The
   *  overlay switches from CTA to stepper. */
  analyzing: boolean;
  /** Live phase map (null when analysis hasn't started or has finished). */
  phases: PhaseMap | null;
  /** Optional one-line status for the brief window before the first phase
   *  event arrives (upload/connect). */
  prePhaseText: string | null;
}

/**
 * Floating overlay rendered ON TOP of the Info-tab skeleton background.
 *
 * Two states share the same card so the position doesn't jump:
 *   - Idle: hero copy + "Analyze with AI" CTA.
 *   - Analyzing: same hero, the CTA collapses to a status line, the violet
 *     stepper takes its place.
 *
 * Container is `pointer-events-none` so the skeleton behind doesn't lose
 * scrollability; the inner card opts back in. The skeleton is visible behind
 * with a translucent surface so it reads as preview rather than competing
 * chrome.
 */
export function NoContextState({ analyzing, phases, prePhaseText }: Props) {
  const hasImage = useEditorStore((s) => s.layers.some((l) => l.type === 'image'));
  const [busy, setBusy] = useState(false);

  const disabled = busy || analyzing || !hasImage;
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
          {analyzing ? 'Analyzing image…' : 'Analyze this image'}
        </h2>
        <p className="text-[11px] leading-snug text-text-secondary max-w-[220px]">
          {analyzing
            ? 'Reading semantic regions, histograms, palette, and suggested adjustments.'
            : 'Let AI read this image — semantic regions, histograms, palette, and suggested adjustments — in a few seconds.'}
        </p>

        {analyzing ? (
          <div className="w-full max-w-[220px] mt-1.5">
            {prePhaseText && (
              <div className="text-[10px] text-text-secondary mb-2">{prePhaseText}</div>
            )}
            <PhaseSteps phases={phases} tone="ai" />
          </div>
        ) : (
          <>
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
              {busy ? 'Starting…' : 'Analyze with AI'}
            </button>
            {hint && <span className="text-[10px] text-text-secondary">{hint}</span>}
          </>
        )}
      </div>
    </div>
  );
}
