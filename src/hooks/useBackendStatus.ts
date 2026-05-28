import { useEffect, useState } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState, type PhaseName } from '@/store/backend-state-slice';
import { onToast, type ToastMessage } from '@/components/ui/Toast';

export type BackendStatusKind = 'progress' | 'success' | 'info' | 'error';

export interface BackendStatus {
  kind: BackendStatusKind;
  text: string;
  /** When true, the consumer can auto-dismiss after a short window. */
  ephemeral: boolean;
}

const READY_DISMISS_MS = 3000;
const TOAST_DISMISS_MS = 4000;

const PHASE_LABELS: Record<PhaseName, string> = {
  mechanical: 'Reading histograms…',
  sam_embed: 'Indexing image regions…',
  ai_context: 'Asking Claude…',
  mask_precompute: 'Tracing regions',
  widget_mint: 'Drafting suggestions…',
};

/**
 * Merge AI-session lifecycle + toast events into a single "what's the backend
 * doing right now?" stream for the docked status bar.
 *
 * Priority:
 *  1. Phase progress            (granular analyze progress, persistent)
 *  2. AI uploading / analysing  (coarse progress, persistent)
 *  3. AI error                  (error, persistent until status changes)
 *  4. Latest toast              (info/error, auto-dismissed)
 *  5. AI ready                  (success, auto-dismissed)
 */
export function useBackendStatus(): BackendStatus | null {
  const aiStatus = useAiSession((s) => s.status);
  const aiError = useAiSession((s) => s.error);
  const phase = useBackendState((s) => s.currentPhase);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);

  const [toastMsg, setToastMsg] = useState<ToastMessage | null>(null);

  // Subscribe to toast events.
  useEffect(() => {
    return onToast((m) => setToastMsg(m));
  }, []);

  // Auto-dismiss toast after TTL.
  useEffect(() => {
    if (!toastMsg) return;
    const h = setTimeout(() => setToastMsg(null), TOAST_DISMISS_MS);
    return () => clearTimeout(h);
  }, [toastMsg]);

  // Auto-dismiss "ready" after a short window.
  const [readyDismissed, setReadyDismissed] = useState(false);
  useEffect(() => {
    if (aiStatus !== 'ready') {
      setReadyDismissed(false);
      return;
    }
    const h = setTimeout(() => setReadyDismissed(true), READY_DISMISS_MS);
    return () => clearTimeout(h);
  }, [aiStatus]);

  if (phase) {
    const detail = phase.phase === 'mask_precompute' && phase.phaseTotal
      ? ` (${phase.done}/${phase.phaseTotal})`
      : '';
    return {
      kind: 'progress',
      text: `${PHASE_LABELS[phase.phase]}${detail} · ${phase.index}/${phase.total}`,
      ephemeral: false,
    };
  }

  if (aiStatus === 'uploading') return { kind: 'progress', text: 'Uploading image…', ephemeral: false };
  if (aiStatus === 'analysing') return { kind: 'progress', text: 'Analysing image…', ephemeral: false };
  if (aiStatus === 'error') return { kind: 'error', text: aiError ?? 'Analysis failed', ephemeral: false };

  if (toastMsg) {
    return {
      kind: toastMsg.variant === 'error' ? 'error' : 'info',
      text: toastMsg.text,
      ephemeral: true,
    };
  }

  // Only show "ready" once MCP is also done — the legacy /api/analyze returns
  // ~2s before widget_mint completes, so we'd otherwise lie to the user.
  if (aiStatus === 'ready' && mcpComplete && !readyDismissed) {
    return { kind: 'success', text: 'Image context ready', ephemeral: true };
  }

  return null;
}
