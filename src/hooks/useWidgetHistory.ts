import { useEffect, useState } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

export interface WidgetHistoryEntry {
  id: string;
  ts: number;
  label: string;
  /** `{ nodeId → { param → value } }` at the before/after boundary, scoped to
   *  this widget. Diffed by the row to render param deltas. */
  paramsBefore: Record<string, Record<string, unknown>>;
  paramsAfter: Record<string, Record<string, unknown>>;
}

export interface WidgetHistoryLog {
  entries: WidgetHistoryEntry[];
  /** Id of the entry matching the live cursor, or null when the cursor sits
   *  before any entry that touched this widget. */
  currentEntryId: string | null;
  canRestore: boolean;
}

/**
 * Subscribe to one widget's slice of the backend history. Refetches whenever
 * `snapshot.revision` changes — the same trigger `useHistoryLog` rides, so a
 * restore / undo / redo anywhere refreshes the timeline and current marker.
 */
export function useWidgetHistory(widgetId: string | null): WidgetHistoryLog | null {
  const sessionId = useBackendState((s) => s.sessionId);
  const revision = useBackendState((s) => s.snapshot?.revision ?? null);
  const [log, setLog] = useState<WidgetHistoryLog | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId || !widgetId) {
      setLog(null);
      return;
    }
    void (async () => {
      try {
        const raw = await backendTools.widgetHistory(sessionId, widgetId);
        if (cancelled || !raw) return;
        setLog({
          entries: raw.entries.map((e) => ({
            id: e.id,
            ts: e.ts,
            label: e.label,
            paramsBefore: e.params_before,
            paramsAfter: e.params_after,
          })),
          currentEntryId: raw.current_entry_id,
          canRestore: raw.can_restore,
        });
      } catch (e) {
        console.warn('[useWidgetHistory] failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, widgetId, revision]);

  return log;
}
