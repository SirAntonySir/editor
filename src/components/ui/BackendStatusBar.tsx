import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CircleX,
  Info,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  useBackendStatus,
  type BackendStatus,
  type BackendStatusKind,
} from '@/hooks/useBackendStatus';
import { useBackendState } from '@/store/backend-state-slice';
import { representativePhaseLabel } from '@/components/ui/PhaseSteps';
import { useAiSession } from '@/hooks/useImageContext';
import { usePreferencesStore } from '@/store/preferences-store';

/** The "Image context ready" line auto-dismisses this long after it appears. */
const READY_AUTODISMISS_MS = 4000;

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

function ReadyLine({
  onShowContext,
  onDismiss,
}: {
  onShowContext: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="relative flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-emerald-400">
      <Sparkles size={12} className="shrink-0" />
      <span className="truncate">Image context ready</span>
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <button
          type="button"
          onClick={onShowContext}
          className="rounded-sm px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-surface hover:text-accent-hover"
        >
          Show context
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-sm p-1 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * Slides in under the toolbar when the backend has something to show. All
 * states are a single line — the full 6-step progress lives in the inspector's
 * Info tab, reachable via "More info" / "Show context".
 * - During analyze: spinner + the current phase label.
 * - After analyze completes: a persistent "ready" line that stays until dismissed.
 * - Otherwise: thin single-line strip (toast / error).
 */
export function BackendStatusBar() {
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const aiStatus = useAiSession((s) => s.status);
  const status = useBackendStatus();

  const preAnalyze = aiStatus === 'uploading' || aiStatus === 'analysing';
  // Live analyze: the pre-phase upload window, or phases streaming before
  // widget_mint completes. Once mcpAnalyzeComplete the live row gives way to
  // the persistent "ready" line.
  const inAnalyze = preAnalyze || (phases !== null && !mcpComplete);

  // Persistent "ready" line. Triggered on the REAL completion signal
  // (mcpAnalyzeComplete = widget_mint done), with an aiStatus === 'ready'
  // fallback for the cached-context path where analyze_image early-returns and
  // emits no phases. Re-armed by resetting dismissal on every transition to
  // 'ready'.
  const [readyDismissed, setReadyDismissed] = useState(false);
  useEffect(() => {
    let prev = useAiSession.getState().status;
    return useAiSession.subscribe((state) => {
      if (state.status === 'ready' && prev !== 'ready') setReadyDismissed(false);
      prev = state.status;
    });
  }, []);

  const showReady =
    !inAnalyze && !readyDismissed && (mcpComplete || aiStatus === 'ready');

  // Auto-dismiss the "ready" line a beat after it appears, so it doesn't linger.
  useEffect(() => {
    if (!showReady) return;
    const t = setTimeout(() => setReadyDismissed(true), READY_AUTODISMISS_MS);
    return () => clearTimeout(t);
  }, [showReady]);

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

  // The auto-dismissing "Image context ready" success from useBackendStatus is
  // replaced by the persistent ready line — skip the strip in that case.
  const stripStatus =
    status && !(showReady && status.kind === 'success') ? status : null;

  const handleShowContext = () => {
    // Open the sidebar + select the Info tab, then clear this banner — its job
    // is done once the user has gone to view the context.
    usePreferencesStore.getState().showImageContext();
    setReadyDismissed(true);
  };

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
      ) : showReady ? (
        <motion.div
          key="ready"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="flex-none overflow-hidden border-b border-separator bg-emerald-500/10"
          role="status"
          aria-live="polite"
          aria-label="Image context ready"
        >
          <ReadyLine
            onShowContext={handleShowContext}
            onDismiss={() => setReadyDismissed(true)}
          />
        </motion.div>
      ) : stripStatus ? (
        <motion.div
          key="strip"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 22, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={`flex-none overflow-hidden border-b border-separator ${STRIP_BG[stripStatus.kind]}`}
          role="status"
          aria-live="polite"
        >
          <div
            className={`h-full flex items-center justify-center gap-1.5 px-3 text-[11px] ${COLORS[stripStatus.kind]}`}
          >
            <StatusContent status={stripStatus} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
