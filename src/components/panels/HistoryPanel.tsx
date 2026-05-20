import { useSyncExternalStore } from 'react';
import { editorDocument } from '@/core/document';
import * as history from '@/core/history';
import type { HistoryStoreState } from '@/core/history';

function useHistoryStore<T>(selector: (state: HistoryStoreState) => T): T {
  const store = editorDocument.historyStore;
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
  );
}

export function HistoryPanelBody() {
  const entries = useHistoryStore((s) => s.entries);
  const canUndo = useHistoryStore((s) => s.canUndo);
  const isRestoring = useHistoryStore((s) => s.isRestoring);

  const handleClick = (index: number) => {
    if (isRestoring) return;
    const path = history.getCurrentPathNodes();
    if (index < 0 || index >= path.length) return;
    history.jumpTo(path[index].id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Initial state */}
        <button
          onClick={() => handleClick(0)}
          disabled={isRestoring || !canUndo}
          className={`w-full flex items-center gap-1.5 px-3 py-1 text-[11px] text-left transition-colors cursor-default
            ${entries.length === 0
              ? 'bg-accent/10 text-text-primary font-medium'
              : 'text-text-primary hover:bg-surface-secondary'
            }`}
        >
          <span className="truncate">Original</span>
        </button>

        {/* History entries */}
        {entries.map((entry, i) => (
          <button
            key={entry.id}
            onClick={() => handleClick(i + 1)}
            disabled={isRestoring}
            className={`w-full flex items-center gap-1.5 px-3 py-1 text-[11px] text-left transition-colors cursor-default
              ${i === entries.length - 1
                ? 'bg-accent/10 text-text-primary font-medium'
                : 'text-text-primary hover:bg-surface-secondary'
              }`}
          >
            <span className="truncate">{entry.label}</span>
            {entry.kind === 'destructive' && (
              <span className="text-[9px] text-text-secondary/50 flex-shrink-0">px</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
