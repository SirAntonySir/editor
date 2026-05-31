import type { PhaseMap } from '@/store/backend-state-slice';
import { PhaseSteps } from '@/components/ui/PhaseSteps';

interface Props {
  phases: PhaseMap | null;
  /** Pre-phase hint shown before the first phase event arrives (upload/connect). */
  prePhaseText?: string | null;
}

/**
 * The full analyze step list, revealed in the Info tab via the status bar's
 * "More info" link while the docked bar shows only the current phase.
 */
export function AnalysisProgressSection({ phases, prePhaseText }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Analysis progress
      </div>
      {prePhaseText && (
        <div className="text-[10px] text-text-secondary mb-1.5">{prePhaseText}</div>
      )}
      <PhaseSteps phases={phases} />
    </section>
  );
}
