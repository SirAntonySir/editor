import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { History } from 'lucide-react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { useHistoryLog, type HistoryEntry } from '@/hooks/useHistoryLog';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { UI } from '@/config';
import { track } from '@/lib/telemetry';

function relativeTime(ts: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ts * 1000) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

interface RowProps {
  entry: HistoryEntry;
  index: number;
  cursor: number;
  onJump: (index: number) => void;
  now: number;
}

function HistoryRow({ entry, index, cursor, onJump, now }: RowProps) {
  const isCurrent = index === cursor;
  const isFuture = index > cursor;
  return (
    <button
      type="button"
      onClick={() => onJump(index)}
      className={[
        'w-full flex items-center gap-2 px-3 py-1.5 text-left rounded-[3px]',
        'hover:bg-[var(--color-surface-secondary)] cursor-pointer outline-none',
        isFuture ? 'opacity-50' : '',
      ].join(' ')}
    >
      <span
        className={[
          'w-1.5 h-1.5 rounded-full flex-none',
          isCurrent
            ? 'bg-[var(--color-accent)]'
            : 'border border-[var(--color-text-secondary)]',
        ].join(' ')}
      />
      <span className="flex-1 truncate text-[12px] text-[var(--color-text-primary)]">
        {entry.label}
      </span>
      <span className="text-[10px] tabular-nums font-mono text-[var(--color-text-secondary)]">
        {relativeTime(entry.ts, now)}
      </span>
    </button>
  );
}

export function HistoryDropdown() {
  const sessionId = useBackendState((s) => s.sessionId);
  const log = useHistoryLog();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const disabled = !log || log.entries.length === 0;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpenedAt(Date.now());
      track('history.open', { entries: log?.entries.length ?? 0 });
    }
    setOpen(nextOpen);
  };

  const onJump = (index: number) => {
    if (!sessionId) return;
    track('history.jump', { index, cursor: log?.cursor ?? -1 });
    void backendTools.jumpHistory(sessionId, index);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center justify-center w-5 h-5 rounded-[3px] transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary cursor-default"
          aria-label="History"
        >
          <History size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          style={{ zIndex: UI.zPopover }}
          className="overlay w-[280px] p-0"
        >
          <div className="px-2 py-1.5 text-[9px] uppercase tracking-[0.20em] font-mono text-[var(--color-text-secondary)] border-b border-[var(--color-separator)]">
            History
          </div>
          <ScrollArea className="h-[280px]">
            <div className="p-1">
              {log && log.entries.length > 0 ? (
                // Newest first.
                [...log.entries]
                  .map((entry, i) => ({ entry, index: i }))
                  .reverse()
                  .map(({ entry, index }) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      index={index}
                      cursor={log.cursor}
                      onJump={onJump}
                      now={openedAt}
                    />
                  ))
              ) : (
                <div className="px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
                  No history yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
