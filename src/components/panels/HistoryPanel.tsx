import { motion } from 'framer-motion';
import { History } from 'lucide-react';
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

export function HistoryPanel() {
  const entries = useHistoryStore((s) => s.entries);
  const canUndo = useHistoryStore((s) => s.canUndo);
  const isRestoring = useHistoryStore((s) => s.isRestoring);

  const handleClick = async (index: number) => {
    if (isRestoring) return;
    const currentIndex = entries.length; // current state is "after" all entries
    const stepsBack = currentIndex - index;

    if (stepsBack > 0) {
      // Undo N times
      for (let i = 0; i < stepsBack; i++) {
        await editorDocument.undo();
      }
    }
    // We don't support clicking future entries in this simplified view
  };

  return (
    <motion.div
      className="absolute top-12 left-2 z-20 w-44 max-h-[calc(100vh-5rem)] glass-panel flex flex-col overflow-hidden"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator flex items-center gap-1.5">
        <History size={12} />
        <span>History</span>
      </div>

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
    </motion.div>
  );
}
