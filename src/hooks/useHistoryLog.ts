import { useEffect, useState } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

export interface HistoryEntry {
  id: string;
  ts: number;
  label: string;
}

export interface HistoryLog {
  entries: HistoryEntry[];
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
}

/** Subscribe to the backend's history log. Refetches whenever the backend
 *  broadcasts a `history.applied` event (mirrored into snapshot.revision). */
export function useHistoryLog(): HistoryLog | null {
  const sessionId = useBackendState((s) => s.sessionId);
  // backendState already updates snapshot.revision on every history.applied;
  // subscribing to it gives us a refetch trigger for free.
  const revision = useBackendState((s) => s.snapshot?.revision ?? null);
  const [log, setLog] = useState<HistoryLog | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setLog(null);
      return;
    }
    void (async () => {
      try {
        const raw = await backendTools.listHistory(sessionId);
        if (cancelled || !raw) return;
        setLog({
          entries: raw.entries,
          cursor: raw.cursor,
          canUndo: raw.can_undo,
          canRedo: raw.can_redo,
        });
      } catch (e) {
        console.warn('[useHistoryLog] failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, revision]);

  return log;
}
