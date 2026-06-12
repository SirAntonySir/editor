import { useEffect, useState } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
import {
  useBackendState,
  representativePhase,
  PHASE_ORDER,
  type PhaseName,
} from '@/store/backend-state-slice';
import { onToast, type ToastMessage } from '@/components/ui/Toast';
import { RUNTIME } from '@/config';

export type BackendStatusKind = 'progress' | 'success' | 'info' | 'error';

export interface BackendStatus {
  kind: BackendStatusKind;
  text: string;
  /** When true, the consumer can auto-dismiss after a short window. */
  ephemeral: boolean;
}

const PHASE_LABELS: Record<PhaseName, string> = {
  update: 'Loading image…',
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
 *
 * The "AI ready" success was retired — SuggestionChips already signals
 * completion by appearing in the row under the status bar.
 */
export function useBackendStatus(): BackendStatus | null {
  const aiStatus = useAiSession((s) => s.status);
  const aiError = useAiSession((s) => s.error);
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);

  const [toastMsg, setToastMsg] = useState<ToastMessage | null>(null);

  // Subscribe to toast events.
  useEffect(() => {
    return onToast((m) => setToastMsg(m));
  }, []);

  // Auto-dismiss toast after TTL.
  useEffect(() => {
    if (!toastMsg) return;
    const h = setTimeout(() => setToastMsg(null), RUNTIME.toastDismissMs);
    return () => clearTimeout(h);
  }, [toastMsg]);

  const rep = representativePhase(phases);
  if (rep && !mcpComplete) {
    const info = phases![rep];
    const detail = rep === 'mask_precompute' && info.total
      ? ` (${info.done ?? 0}/${info.total})`
      : '';
    const idx = PHASE_ORDER.indexOf(rep) + 1;
    return {
      kind: 'progress',
      text: `${PHASE_LABELS[rep]}${detail} · ${idx}/${PHASE_ORDER.length}`,
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

  return null;
}
