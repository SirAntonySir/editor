import { Check, Loader2 } from 'lucide-react';
import {
  representativePhase,
  type PhaseMap,
  type PhaseName,
  type PhaseInfo,
  type PhaseStatus,
} from '@/store/backend-state-slice';

/** Canonical analyze phases with their human labels — single source of truth
 *  shared by the docked status bar and the inspector's Info tab. */
export const PHASES: { key: PhaseName; label: string }[] = [
  { key: 'update', label: 'Update' },
  { key: 'mechanical', label: 'Mechanical' },
  { key: 'ai_context', label: 'AI context' },
  { key: 'widget_mint', label: 'Suggest' },
  // 'sam_embed' (SAM embed) + 'mask_precompute' (Regions) are omitted while SAM
  // is gated off — the backend no longer emits them. Re-add when segmentation
  // returns.
];

/** Label of the furthest-along active phase, for single-line UIs. Null when
 *  no phase is active. */
export function representativePhaseLabel(phases: PhaseMap | null): string | null {
  const key = representativePhase(phases);
  return key ? PHASES.find((p) => p.key === key)?.label ?? null : null;
}

function subCount(key: PhaseName, info: PhaseInfo | undefined): string | null {
  return key === 'mask_precompute' && info?.total
    ? `${info.done ?? 0}/${info.total}`
    : null;
}

function StepIcon({ state }: { state: PhaseStatus }) {
  if (state === 'done') {
    return (
      <span
        className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white"
        aria-hidden
      >
        <Check size={10} strokeWidth={3} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className="flex size-4 items-center justify-center text-accent"
        aria-hidden
      >
        <Loader2 size={12} className="animate-spin" />
      </span>
    );
  }
  return (
    <span
      className="flex size-4 items-center justify-center rounded-full border border-separator"
      aria-hidden
    >
      <span className="size-1 rounded-full bg-text-secondary/40" />
    </span>
  );
}

/**
 * Vertical list of the analyze phases with per-step status. Used by the Info
 * tab to reveal the full progress that the docked bar collapses to one line.
 */
export function PhaseSteps({ phases }: { phases: PhaseMap | null }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {PHASES.map((p) => {
        const info = phases?.[p.key];
        const state: PhaseStatus = info?.status ?? 'pending';
        const sub = subCount(p.key, info);
        const labelColor =
          state === 'active'
            ? 'text-text-primary font-medium'
            : state === 'done'
            ? 'text-text-secondary'
            : 'text-text-secondary/50';
        return (
          <li key={p.key} className="flex items-center gap-2 text-[11px]">
            <StepIcon state={state} />
            <span className={`flex-1 leading-none ${labelColor}`}>{p.label}</span>
            {sub && (
              <span className="tabular-nums text-[10px] leading-none text-text-secondary">
                {sub}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
