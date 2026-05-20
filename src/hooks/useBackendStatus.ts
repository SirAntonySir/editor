import { useEffect, useState } from 'react';
import { useAiSession } from '@/hooks/useImageContext';
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

/**
 * Merge AI-session lifecycle + toast events into a single "what's the backend
 * doing right now?" stream for the docked status bar.
 *
 * Priority:
 *  1. AI uploading / analysing  (progress, persistent)
 *  2. AI error                  (error, persistent until status changes)
 *  3. Latest toast              (info/error, auto-dismissed)
 *  4. AI ready                  (success, auto-dismissed)
 */
export function useBackendStatus(): BackendStatus | null {
  const aiStatus = useAiSession((s) => s.status);
  const aiError = useAiSession((s) => s.error);

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

  if (aiStatus === 'ready' && !readyDismissed) {
    return { kind: 'success', text: 'Image context ready', ephemeral: true };
  }

  return null;
}
