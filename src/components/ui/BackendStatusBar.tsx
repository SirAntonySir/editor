import { Fragment, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
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
import { useBackendState, type PhaseName, type PhaseState } from '@/store/backend-state-slice';
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

const PHASES: { key: PhaseName; label: string }[] = [
  { key: 'mechanical', label: 'Mechanical' },
  { key: 'sam_embed', label: 'SAM embed' },
  { key: 'ai_context', label: 'AI context' },
  { key: 'mask_precompute', label: 'Regions' },
  { key: 'widget_mint', label: 'Suggest' },
];

type NodeState = 'done' | 'active' | 'pending';

function PhaseNode({ label, state }: { label: string; state: NodeState }) {
  const labelColor =
    state === 'active'
      ? 'text-text-primary font-semibold'
      : state === 'done'
      ? 'text-text-secondary'
      : 'text-text-secondary/60';

  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div
        className={
          state === 'done'
            ? 'w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center'
            : state === 'active'
            ? 'w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin'
            : 'w-5 h-5 rounded-full border border-separator flex items-center justify-center'
        }
        aria-hidden
      >
        {state === 'done' && <Check size={12} strokeWidth={3} />}
        {state === 'pending' && (
          <span className="w-1 h-1 rounded-full bg-text-secondary/40" />
        )}
      </div>
      <span className={`text-[9px] leading-none truncate ${labelColor}`}>{label}</span>
    </div>
  );
}

function Connector({ state }: { state: NodeState }) {
  const bg =
    state === 'done' ? 'bg-emerald-500' : state === 'active' ? 'bg-accent' : 'bg-separator';
  return <div className={`h-px flex-none w-5 ${bg}`} aria-hidden />;
}

function PhaseStepper({
  phase,
  prePhaseText,
}: {
  phase: PhaseState | null;
  prePhaseText: string | null;
}) {
  // When no phase has started yet, activeIdx is -1 so every node renders as pending.
  const activeIdx = phase ? PHASES.findIndex((p) => p.key === phase.phase) : -1;
  const sub =
    phase && phase.phase === 'mask_precompute' && phase.phaseTotal
      ? `${phase.done}/${phase.phaseTotal}`
      : null;

  return (
    <div className="flex flex-col items-center gap-1 px-4 py-2">
      <div className="flex items-center justify-center gap-1.5">
        {PHASES.map((p, i) => {
          const nodeState: NodeState =
            i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          const connectorState: NodeState =
            i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          return (
            <Fragment key={p.key}>
              <div className="flex flex-col items-center gap-0.5">
                <PhaseNode label={p.label} state={nodeState} />
                {nodeState === 'active' && sub && (
                  <span className="text-[9px] text-text-secondary tabular-nums leading-none -mt-0.5">
                    {sub}
                  </span>
                )}
              </div>
              {i < PHASES.length - 1 && <Connector state={connectorState} />}
            </Fragment>
          );
        })}
      </div>
      {prePhaseText && (
        <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
          <Loader2 size={10} className="animate-spin shrink-0" />
          <span>{prePhaseText}</span>
        </div>
      )}
    </div>
  );
}

function ReadyStepper() {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-2">
      <div className="flex items-center justify-center gap-1.5">
        {PHASES.map((p, i) => (
          <Fragment key={p.key}>
            <PhaseNode label={p.label} state="done" />
            {i < PHASES.length - 1 && <Connector state="done" />}
          </Fragment>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
        <Sparkles size={10} className="shrink-0" />
        <span>Image context ready</span>
      </div>
    </div>
  );
}

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

function ReadyActions({
  onShowContext,
  onDismiss,
}: {
  onShowContext: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
      <button
        type="button"
        onClick={onShowContext}
        className="text-[10px] text-accent hover:text-accent-hover font-medium px-2 py-1 rounded-sm hover:bg-surface transition-colors"
      >
        Show context
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-secondary hover:text-text-primary p-1 rounded-sm hover:bg-surface transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * Slides in under the toolbar when the backend has something to show.
 * - During analyze: 5-node horizontal stepper (Option B from brainstorm) that
 *   tracks SSE phase progress.
 * - After analyze completes: a persistent "ready" bar with a Show-context link
 *   and a dismiss button. Stays until the user dismisses it.
 * - Otherwise: thin single-line strip (toast / error).
 */
export function BackendStatusBar() {
  const phase = useBackendState((s) => s.currentPhase);
  const aiStatus = useAiSession((s) => s.status);
  const status = useBackendStatus();

  const inAnalyze = phase || aiStatus === 'uploading' || aiStatus === 'analysing';

  // Persistent "ready" bar: shown once aiStatus === 'ready', hidden when the
  // user dismisses it. We trigger on aiStatus (HTTP /api/analyze returned)
  // rather than mcpAnalyzeComplete (SSE widget_mint completion) because the
  // legacy /api/analyze response is the reliable "done" signal — SSE phase
  // events may never arrive if the backend isn't emitting them, and we don't
  // want the bar to silently vanish in that case. Re-armed by subscribing to
  // the AI session and resetting dismissal on every transition to 'ready'.
  const [readyDismissed, setReadyDismissed] = useState(false);
  useEffect(() => {
    let prev = useAiSession.getState().status;
    return useAiSession.subscribe((state) => {
      if (state.status === 'ready' && prev !== 'ready') setReadyDismissed(false);
      prev = state.status;
    });
  }, []);

  const showReady = aiStatus === 'ready' && !inAnalyze && !readyDismissed;

  const prePhaseText = phase
    ? null
    : aiStatus === 'uploading'
    ? 'Uploading image…'
    : aiStatus === 'analysing'
    ? 'Connecting to backend…'
    : null;

  const ariaLabel = phase
    ? `Analyzing image: ${PHASES.find((p) => p.key === phase.phase)?.label}`
    : prePhaseText ?? 'Analyzing image';

  // The auto-dismissing "Image context ready" success from useBackendStatus is
  // replaced by the persistent ready bar — skip the strip in that case.
  const stripStatus =
    status && !(showReady && status.kind === 'success') ? status : null;

  const handleShowContext = () => {
    // TODO: wire to the image-info inspector tab once it lands.
    // The new tab is being built in parallel; this is a placeholder so the
    // affordance is in place when wiring is ready.
  };

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {inAnalyze ? (
        <motion.div
          key="stepper"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="flex-none overflow-hidden border-b border-separator bg-surface-secondary"
          role="status"
          aria-live="polite"
          aria-label={ariaLabel}
        >
          <PhaseStepper phase={phase} prePhaseText={prePhaseText} />
        </motion.div>
      ) : showReady ? (
        <motion.div
          key="ready"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="flex-none overflow-hidden border-b border-separator bg-emerald-500/10 relative"
          role="status"
          aria-live="polite"
          aria-label="Image context ready"
        >
          <ReadyStepper />
          <ReadyActions
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
