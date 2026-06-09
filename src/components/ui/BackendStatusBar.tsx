import { AnimatePresence, motion } from 'framer-motion';
import {
  CircleX,
  Info,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  useBackendStatus,
  type BackendStatus,
  type BackendStatusKind,
} from '@/hooks/useBackendStatus';
import { useBackendState } from '@/store/backend-state-slice';
import { representativePhaseLabel } from '@/components/ui/PhaseSteps';
import { useAiSession } from '@/hooks/useImageContext';

const COLORS: Record<BackendStatusKind, string> = {
  progress: 'text-text-secondary',
  success: 'text-emerald-400',
  info: 'text-text-secondary',
  error: 'text-red-400',
};

const STRIP_BG: Record<BackendStatusKind, string> = {
  progress: 'bg-surface-secondary',
  success: 'bg-emerald-500/10',
  info: 'bg-surface-secondary',
  error: 'bg-red-500/10',
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

/** Single-line analyzing row: spinner + current phase, with a More-info link
 *  that flips the inspector to its Info tab (where the full step list lives). */
function AnalyzingLine({ text }: { text: string }) {
  return (
    <div className="relative flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-text-secondary">
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span className="truncate">{text}</span>
      <button
        type="button"
        onClick={() => usePreferencesStore.getState().showImageContext()}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-surface hover:text-accent-hover"
      >
        More info
      </button>
    </div>
  );
}

/**
 * Slides in under the toolbar when the backend has something to show.
 * - During analyze: spinner + the current phase label.
 * - Otherwise: thin single-line strip (toast / error).
 *
 * The "Image context ready" line was retired once SuggestionChips landed —
 * the pending chips themselves are the cue that analyze finished, and the
 * inspector Info tab is one click away when the user wants the full context.
 */
export function BackendStatusBar() {
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const aiStatus = useAiSession((s) => s.status);
  const status = useBackendStatus();

  const preAnalyze = aiStatus === 'uploading' || aiStatus === 'analysing';
  // Live analyze: the pre-phase upload window, or phases streaming before
  // widget_mint completes.
  const inAnalyze = preAnalyze || (phases !== null && !mcpComplete);

  // While mcpComplete is true the map holds a finished run's all-done state. A
  // re-upload re-enters the pre-phase window before its first event arrives, so
  // suppress the stale map until the new run's phase.started(update) resets it.
  const livePhases = mcpComplete ? null : phases;

  const phaseLabel = representativePhaseLabel(livePhases);
  const analyzingText = phaseLabel
    ? `Analyzing · ${phaseLabel}`
    : aiStatus === 'uploading'
    ? 'Uploading image…'
    : aiStatus === 'analysing'
    ? 'Connecting to backend…'
    : 'Analyzing image…';

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {inAnalyze ? (
        <motion.div
          key="analyzing"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="flex-none overflow-hidden border-b border-separator bg-surface-secondary"
          role="status"
          aria-live="polite"
          aria-label={`Analyzing image: ${analyzingText}`}
        >
          <AnalyzingLine text={analyzingText} />
        </motion.div>
      ) : status ? (
        <motion.div
          key="strip"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 22, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={`flex-none overflow-hidden border-b border-separator ${STRIP_BG[status.kind]}`}
          role="status"
          aria-live="polite"
        >
          <div
            className={`h-full flex items-center justify-center gap-1.5 px-3 text-[11px] ${COLORS[status.kind]}`}
          >
            <StatusContent status={status} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
