import { useSyncExternalStore } from 'react';
import { editorDocument } from '@/core/document';
import type { HistoryStoreState } from '@/core/history';

function useHistoryStore<T>(selector: (state: HistoryStoreState) => T): T {
  const store = editorDocument.historyStore;
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
  );
}

export function HistoryPanelBody() {
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Initial state */}
        <button
          onClick={() => editorDocument.undo()}
          disabled={!canUndo}
          className={`w-full flex items-center gap-1.5 px-3 py-1 text-[11px] text-left transition-colors cursor-default
            ${!canUndo
              ? 'bg-accent/10 text-text-primary font-medium'
              : 'text-text-primary hover:bg-surface-secondary'
            }`}
        >
          <span className="truncate">Original</span>
        </button>

        <div className="px-3 py-2 text-[10px] text-text-secondary/60">
          {canUndo || canRedo ? 'Use ⌘Z / ⌘⇧Z to navigate history' : 'No history yet'}
        </div>
      </div>
    </div>
  );
}
