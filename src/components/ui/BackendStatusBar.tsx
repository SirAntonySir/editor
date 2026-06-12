import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  CircleX,
  Info,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  useBackendStatus,
  type BackendStatus,
  type BackendStatusKind,
} from '@/hooks/useBackendStatus';
import { useBackendState } from '@/store/backend-state-slice';
import { usePreferencesStore } from '@/store/preferences-store';
import { representativePhaseLabel, PHASES } from '@/components/ui/PhaseSteps';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';
import { RUNTIME } from '@/config';

const COLORS: Record<BackendStatusKind, string> = {
  progress: 'text-text-secondary',
  success: 'text-emerald-400',
  info: 'text-text-secondary',
  error: 'text-red-400',
};

function StatusContent({ status }: { status: BackendStatus }) {
  const Icon =
    status.kind === 'success'
      ? Sparkles
      : status.kind === 'progress'
      ? Loader2
      : status.kind === 'error'
      ? CircleX
      : Info;
  const spin = status.kind === 'progress';
  return (
    <>
      <Icon size={12} className={spin ? 'animate-spin shrink-0' : 'shrink-0'} />
      <span className="truncate">{status.text}</span>
    </>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/** Progress ratio in [0, 1] derived from the phase map. Counts done phases,
 *  adds the active phase's sub-progress (mask_precompute is the only phase
 *  that reports done/total), and otherwise gives half-credit to the active
 *  phase so the bar visibly moves when a long phase is mid-flight. */
function computeProgress(
  phases: ReturnType<typeof useBackendState.getState>['phases'],
  uploading: boolean,
  cancelled: boolean,
  complete: boolean,
): number {
  if (cancelled) return 0;
  if (complete) return 1;
  if (!phases) return uploading ? 0.05 : 0;
  const total = PHASES.length;
  let done = 0;
  let activeFraction = 0;
  for (const { key } of PHASES) {
    const info = phases[key];
    if (info?.status === 'done') {
      done += 1;
    } else if (info?.status === 'active') {
      if (info.total && info.total > 0) {
        activeFraction = Math.max(activeFraction, (info.done ?? 0) / info.total);
      } else {
        activeFraction = Math.max(activeFraction, 0.5);
      }
    }
  }
  return Math.min(1, (done + activeFraction) / total);
}

interface AnalyzingRowProps {
  text: string;
  progress: number;
  complete: boolean;
  cancelling: boolean;
  cancellable: boolean;
  onCancel: () => void;
  usage: ReturnType<typeof useBackendState.getState>['usage'];
}

/** The analyzing row: progress bar across the top, label + token count below,
 *  with a cancel button on the trailing edge while in-flight. */
function AnalyzingRow({
  text,
  progress,
  complete,
  cancelling,
  cancellable,
  onCancel,
  usage,
}: AnalyzingRowProps) {
  return (
    <div className="flex flex-col w-full">
      {/* Progress bar — analyze is AI-driven, so the in-flight bar reads
          AI-violet to match the Sparkles affordance + AI widget chrome. */}
      <div className="relative h-0.5 w-full overflow-hidden bg-surface-secondary/60">
        <motion.div
          className="h-full bg-ai"
          initial={false}
          animate={{ width: `${Math.max(2, progress * 100)}%` }}
          transition={{ duration: complete ? 0.25 : 0.4, ease: [0.2, 0, 0, 1] }}
        />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 w-full text-[11px] text-text-secondary">
        {complete ? (
          <span
            className="flex size-3 items-center justify-center rounded-full bg-ai text-white shrink-0"
            aria-hidden
          >
            <Check size={9} strokeWidth={3} />
          </span>
        ) : (
          <Loader2 size={12} className="animate-spin shrink-0 text-ai" />
        )}
        <span className="flex-1 truncate">{text}</span>
        {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && (
          <span
            className="tabular-nums text-[10px] text-text-secondary/70 shrink-0"
            title={`Input: ${usage.inputTokens.toLocaleString()} · Output: ${usage.outputTokens.toLocaleString()} · Cached: ${usage.cacheRead.toLocaleString()}`}
          >
            {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
          </span>
        )}
        <button
          type="button"
          onClick={() => usePreferencesStore.getState().showImageContext()}
          className="ml-0.5 rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-ai
            transition-colors hover:bg-surface-secondary hover:opacity-80 shrink-0"
        >
          More info
        </button>
        {cancellable && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            aria-label="Cancel analysis"
            title={cancelling ? 'Cancelling…' : 'Cancel analysis'}
            className="ml-0.5 inline-flex size-5 items-center justify-center rounded-sm
              text-text-secondary/70 transition-colors
              hover:bg-surface-secondary hover:text-text-primary
              disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Slides in under the toolbar when the backend has something to show.
 * - During analyze: animated progress bar driven by phase completion, with a
 *   live token count and a cancel button.
 * - When analyze finishes: holds for ~1.2s in a "complete" state (filled bar +
 *   check) before exiting. Cancellation skips this hold.
 * - Otherwise: thin single-line strip (toast / error) from useBackendStatus.
 */
export function BackendStatusBar() {
  const sessionId = useBackendState((s) => s.sessionId);
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const mcpCancelled = useBackendState((s) => s.mcpAnalyzeCancelled);
  const cancelling = useBackendState((s) => s.cancelling);
  const usage = useBackendState((s) => s.usage);
  const aiStatus = useAiSession((s) => s.status);
  const status = useBackendStatus();

  const preAnalyze = aiStatus === 'uploading' || aiStatus === 'analysing';
  const liveAnalyzing = preAnalyze || (phases !== null && !mcpComplete && !mcpCancelled);

  // ── Complete-hold state machine ────────────────────────────────────────
  // We want the bar to linger for ~1.2s after mcpComplete flips true, showing
  // a filled bar + check + "Analysis complete". Cancellation skips the hold
  // (we don't want to celebrate a cancelled run).
  //
  // Subscribed via zustand's subscribe() rather than a useEffect on the
  // selected slice so the setState fires from an external-system callback
  // (the legitimate React idiom), not synchronously in an effect body.
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    let timeoutId: number | undefined;
    const unsubscribe = useBackendState.subscribe((s, prev) => {
      const justCompleted = s.mcpAnalyzeComplete && !prev.mcpAnalyzeComplete;
      if (justCompleted && !s.mcpAnalyzeCancelled) {
        if (timeoutId) window.clearTimeout(timeoutId);
        setHolding(true);
        timeoutId = window.setTimeout(() => setHolding(false), RUNTIME.statusHoldMs);
      }
      // A new analyze run kicks off — drop any pending hold from the previous run.
      if (!s.mcpAnalyzeComplete && prev.mcpAnalyzeComplete) {
        if (timeoutId) window.clearTimeout(timeoutId);
        setHolding(false);
      }
    });
    return () => {
      unsubscribe();
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  const inAnalyze = liveAnalyzing || holding;
  const inCompleteHold = holding && !liveAnalyzing;

  const livePhases = mcpComplete ? null : phases;
  const phaseLabel = representativePhaseLabel(livePhases);

  const analyzingText = useMemo(() => {
    if (inCompleteHold) return 'Analysis complete';
    if (cancelling) return 'Cancelling…';
    if (mcpCancelled) return 'Cancelled';
    if (phaseLabel) return `Analyzing · ${phaseLabel}`;
    if (aiStatus === 'uploading') return 'Uploading image…';
    if (aiStatus === 'analysing') return 'Connecting to backend…';
    return 'Analyzing image…';
  }, [inCompleteHold, cancelling, mcpCancelled, phaseLabel, aiStatus]);

  const progress = computeProgress(phases, preAnalyze, mcpCancelled, inCompleteHold);

  const handleCancel = () => {
    if (!sessionId || cancelling) return;
    useBackendState.getState().setCancelling(true);
    void backendTools.cancelAnalyze(sessionId).catch(() => {
      // If the request fails, clear the optimistic cancelling flag so the
      // user can retry. The phase.cancelled event won't arrive in this case.
      useBackendState.getState().setCancelling(false);
    });
  };

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {inAnalyze ? (
        <motion.div
          key="analyzing"
          layout
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          style={{
            background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
          }}
          className="overlay pointer-events-auto overflow-hidden
            backdrop-blur-md flex items-center min-w-[320px]"
          role="status"
          aria-live="polite"
          aria-label={`Analyzing image: ${analyzingText}`}
        >
          <AnalyzingRow
            text={analyzingText}
            progress={progress}
            complete={inCompleteHold}
            cancelling={cancelling}
            cancellable={liveAnalyzing && !inCompleteHold && !!sessionId}
            onCancel={handleCancel}
            usage={usage}
          />
        </motion.div>
      ) : status ? (
        <motion.div
          key="strip"
          layout
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          style={{
            background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
          }}
          className="overlay pointer-events-auto overflow-hidden backdrop-blur-md min-w-[300px]"
          role="status"
          aria-live="polite"
        >
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] ${COLORS[status.kind]}`}
          >
            <StatusContent status={status} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
