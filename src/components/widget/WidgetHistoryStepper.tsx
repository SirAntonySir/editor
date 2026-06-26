import { useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { useWidgetHistory } from '@/hooks/useWidgetHistory';
import { resolveStep } from '@/lib/widget-history-step';
import { Tooltip } from '@/components/ui/Tooltip';

interface Props {
  widgetId: string;
  /** Snap all of this widget's bindings back to their defaults. Hosted on this
   *  strip (moved off the header) so every per-widget action lives in one row. */
  onReset: () => void;
}

const STRIP_BTN =
  'inline-flex items-center justify-center size-5 rounded-[3px] ' +
  'text-text-secondary hover:text-text-primary hover:bg-surface-secondary ' +
  'transition-colors disabled:opacity-30 disabled:hover:text-text-secondary ' +
  'disabled:cursor-not-allowed';

/**
 * Per-widget action strip rendered inside the widget body (between header and
 * controls). Left: per-widget undo/redo — ‹ › step this widget back/forward
 * through its own timeline, each step restoring its params (a forward backend
 * mutation that lands in the global history too, tagged `is_restore` so it's
 * hidden from this timeline; "current" comes from the backend matching live
 * params, so the arrows behave like a scoped undo/redo). No step counter — the
 * arrows just enable/disable at the ends. Right: Reset (snap bindings to
 * defaults). The arrows hide until the widget has history; Reset is always
 * available.
 */
export function WidgetHistoryStepper({ widgetId, onReset }: Props) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const log = useWidgetHistory(widgetId);
  const [pending, setPending] = useState(false);

  const entries = log?.entries ?? [];
  const hasHistory = entries.length > 0;
  const { prevId, nextId } = resolveStep(entries, log?.currentEntryId ?? null);
  const restoreDisabled = offline || pending || !(log?.canRestore ?? false);

  function restore(entryId: string | null) {
    if (!sessionId || !entryId || restoreDisabled) return;
    setPending(true);
    void backendTools
      .restoreWidgetToRevision(sessionId, widgetId, entryId)
      .finally(() => setPending(false));
  }

  return (
    <div className="flex items-center justify-between gap-2 px-1.5 py-0.5 border-b border-separator">
      {hasHistory ? (
        <div className="flex items-center gap-0.5">
          <Tooltip label="Undo — step to older state">
            <button
              type="button"
              aria-label="Undo widget step"
              disabled={restoreDisabled || prevId === null}
              onClick={() => restore(prevId)}
              className={STRIP_BTN}
            >
              <ChevronLeft size={13} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Redo — step to newer state">
            <button
              type="button"
              aria-label="Redo widget step"
              disabled={restoreDisabled || nextId === null}
              onClick={() => restore(nextId)}
              className={STRIP_BTN}
            >
              <ChevronRight size={13} aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : (
        <span aria-hidden />
      )}
      <Tooltip label="Reset to defaults">
        <button
          type="button"
          aria-label="Reset widget"
          disabled={offline}
          onClick={onReset}
          className={STRIP_BTN}
        >
          <RotateCcw size={12} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
