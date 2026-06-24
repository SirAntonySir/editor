import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { useWidgetHistory } from '@/hooks/useWidgetHistory';
import { resolveStep } from '@/lib/widget-history-step';
import { Tooltip } from '@/components/ui/Tooltip';

interface Props {
  widgetId: string;
}

const STEP_BTN =
  'inline-flex items-center justify-center size-5 rounded-[3px] ' +
  'text-text-secondary hover:text-text-primary hover:bg-surface-secondary ' +
  'transition-colors disabled:opacity-30 disabled:hover:text-text-secondary ' +
  'disabled:cursor-not-allowed';

/**
 * Compact per-widget history stepper rendered as a row inside the widget body
 * (between header and controls). ‹ n/N › walks this widget's timeline, each
 * step restoring its params — a forward backend mutation that lands in the
 * global history too (tagged `is_restore`, so it's hidden from this timeline).
 * "Current" comes from the backend matching live params, so back/forward behave
 * like a per-widget undo/redo. Renders nothing until the widget has history.
 */
export function WidgetHistoryStepper({ widgetId }: Props) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const log = useWidgetHistory(widgetId);
  const [pending, setPending] = useState(false);

  const entries = log?.entries ?? [];
  if (entries.length === 0) return null;

  const { index, total, prevId, nextId } = resolveStep(entries, log?.currentEntryId ?? null);
  const restoreDisabled = offline || pending || !(log?.canRestore ?? false);

  function restore(entryId: string | null) {
    if (!sessionId || !entryId || restoreDisabled) return;
    setPending(true);
    void backendTools
      .restoreWidgetToRevision(sessionId, widgetId, entryId)
      .finally(() => setPending(false));
  }

  return (
    <div className="flex items-center justify-between gap-2 px-1.5 py-1 border-b border-separator">
      <Tooltip label="Step to older state">
        <button
          type="button"
          aria-label="Step back"
          disabled={restoreDisabled || prevId === null}
          onClick={() => restore(prevId)}
          className={STEP_BTN}
        >
          <ChevronLeft size={13} aria-hidden />
        </button>
      </Tooltip>
      <span className="text-[10px] tabular-nums font-mono text-text-secondary">
        {index + 1} / {total}
      </span>
      <Tooltip label="Step to newer state">
        <button
          type="button"
          aria-label="Step forward"
          disabled={restoreDisabled || nextId === null}
          onClick={() => restore(nextId)}
          className={STEP_BTN}
        >
          <ChevronRight size={13} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
