import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { History } from 'lucide-react';
import { useStore } from 'zustand';
import { useEditorStore } from '@/store';

interface TemporalState {
  pastStates: Record<string, unknown>[];
  futureStates: Record<string, unknown>[];
  undo: (steps?: number) => void;
  redo: (steps?: number) => void;
}

function useTemporalStore<T>(selector: (state: TemporalState) => T): T {
  return useStore(useEditorStore.temporal as never, selector);
}

type PartialState = {
  layers?: { id: string; name: string; type?: string; adjustmentStack?: { adjustments: { type: string; name: string }[] } }[];
  activeLayerId?: string | null;
  pixelVersion?: number;
};

function describeStep(prev: PartialState | null, curr: PartialState): string {
  if (!prev) return 'Open Image';

  const prevLayers = prev.layers ?? [];
  const currLayers = curr.layers ?? [];

  if (currLayers.length > prevLayers.length) {
    const added = currLayers.find((l) => !prevLayers.some((p) => p.id === l.id));
    return added ? `Add ${added.name}` : 'Add Layer';
  }

  if (currLayers.length < prevLayers.length) {
    const removed = prevLayers.find((l) => !currLayers.some((c) => c.id === l.id));
    return removed ? `Delete ${removed.name}` : 'Delete Layer';
  }

  for (const cl of currLayers) {
    const pl = prevLayers.find((p) => p.id === cl.id);
    if (!pl) continue;
    const pa = pl.adjustmentStack?.adjustments ?? [];
    const ca = cl.adjustmentStack?.adjustments ?? [];

    if (ca.length > pa.length) {
      return `Add ${ca[ca.length - 1]?.name ?? 'Adjustment'}`;
    }
    if (ca.length < pa.length) return 'Remove Adjustment';
    if (ca.length > 0 && JSON.stringify(ca) !== JSON.stringify(pa)) {
      const changed = ca.find((a, i) => JSON.stringify(a) !== JSON.stringify(pa[i]));
      return changed ? `Adjust ${changed.name}` : 'Adjust';
    }
  }

  if (prev.pixelVersion !== curr.pixelVersion) return 'Edit Pixels';

  return 'Edit';
}

export function HistoryPanel() {
  const pastStates = useTemporalStore((s) => s.pastStates);
  const futureStates = useTemporalStore((s) => s.futureStates);
  const undo = useTemporalStore((s) => s.undo);
  const redo = useTemporalStore((s) => s.redo);

  // Subscribe to live store state so the current entry updates on slider changes
  const currentLayers = useEditorStore((s) => s.layers);
  const currentActiveLayerId = useEditorStore((s) => s.activeLayerId);
  const currentPixelVersion = useEditorStore((s) => s.pixelVersion);

  const entries = useMemo(() => {
    const result: { label: string; type: 'past' | 'current' | 'future'; stepsFromCurrent: number }[] = [];

    // Past: show last 19 entries (+ current = 20 total)
    const maxPast = 19;
    const start = Math.max(0, pastStates.length - maxPast);

    for (let i = start; i < pastStates.length; i++) {
      const prev = i === 0 ? null : pastStates[i - 1];
      result.push({
        label: describeStep(prev as PartialState | null, pastStates[i] as PartialState),
        type: 'past',
        stepsFromCurrent: pastStates.length - i,
      });
    }

    // Current state (from reactive subscriptions)
    const currentPartial: PartialState = { layers: currentLayers as PartialState['layers'], activeLayerId: currentActiveLayerId, pixelVersion: currentPixelVersion };
    const lastPast = pastStates.length > 0 ? pastStates[pastStates.length - 1] : null;
    result.push({
      label: pastStates.length === 0 ? 'Open Image' : describeStep(lastPast as PartialState | null, currentPartial),
      type: 'current',
      stepsFromCurrent: 0,
    });

    // Future: show up to 5
    for (let i = 0; i < Math.min(futureStates.length, 5); i++) {
      const prev = i === 0 ? currentPartial : futureStates[i - 1];
      result.push({
        label: describeStep(prev as PartialState, futureStates[i] as PartialState),
        type: 'future',
        stepsFromCurrent: i + 1,
      });
    }

    return result;
  }, [pastStates, futureStates, currentLayers, currentActiveLayerId, currentPixelVersion]);

  const handleClick = (entry: typeof entries[number]) => {
    if (entry.type === 'current') return;
    if (entry.type === 'past') undo(entry.stepsFromCurrent);
    if (entry.type === 'future') redo(entry.stepsFromCurrent);
  };

  return (
    <motion.div
      className="absolute top-12 left-2 bottom-8 z-20 w-44 glass-panel flex flex-col overflow-hidden"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="px-3 py-2 text-xs font-medium text-text-secondary border-b border-separator flex items-center gap-1.5">
        <History size={12} />
        <span>History</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.map((entry, i) => (
          <button
            key={i}
            onClick={() => handleClick(entry)}
            className={`w-full flex items-center gap-1.5 px-3 py-1 text-[11px] text-left transition-colors cursor-default
              ${entry.type === 'current'
                ? 'bg-accent/10 text-text-primary font-medium'
                : entry.type === 'future'
                  ? 'text-text-secondary/40 hover:bg-surface-secondary/40'
                  : 'text-text-primary hover:bg-surface-secondary'
              }`}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
