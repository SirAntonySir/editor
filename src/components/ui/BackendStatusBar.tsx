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
import { usePreferencesStore } from '@/store/preferences-store';
import { representativePhaseLabel } from '@/components/ui/PhaseSteps';
import { useAiSession } from '@/hooks/useImageContext';

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

/** Single-line analyzing row: spinner + current phase, with a More-info link
 *  that flips the inspector to its Info tab (where the full step list lives). */
function AnalyzingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 w-full text-[11px] text-text-secondary">
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span className="flex-1 truncate">{text}</span>
      <button
        type="button"
        onClick={() => usePreferencesStore.getState().showImageContext()}
        className="ml-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-accent
          transition-colors hover:bg-surface-secondary hover:text-accent-hover"
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
          layout
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          style={{
            background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
          }}
          className="overlay pointer-events-auto overflow-hidden
            backdrop-blur-md flex items-center min-w-[300px]"
          role="status"
          aria-live="polite"
          aria-label={`Analyzing image: ${analyzingText}`}
        >
          <AnalyzingLine text={analyzingText} />
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
