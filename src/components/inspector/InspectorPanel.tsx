import { useBackendState } from '@/store/backend-state-slice';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { useEditorStore } from '@/store';
import { selectAllWidgets } from '@/lib/widget-projection';
import { InspectorWidgetRow } from './InspectorWidgetRow';
import { maskStore } from '@/core/mask-store';
import type { MaskSummary } from '@/types/widget';

const EMPTY_MASKS: MaskSummary[] = [];

export function InspectorPanel() {
  const selectedSegmentId = useSegmentSelection((s) => s.selectedSegmentId);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  // Use snapshot revision as a stable scalar to trigger re-renders when snapshot changes
  useBackendState((s) => s.snapshot?.revision ?? 0);
  const masksIndex = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  // Subscribe so projection recomputes when any layer's adjustment stack changes.
  useEditorStore((s) =>
    s.layers.map((l) => `${l.id}:${l.adjustmentStack.adjustments.length}`).join('|'),
  );

  const all = selectAllWidgets();
  const suggestions = all.filter((w) =>
    w.variant === 'ai' && w._widget?.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );
  const actives = all.filter((w) => !suggestions.includes(w));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 flex flex-col">

      {/* Selection — single row */}
      <SelectionRow maskId={selectedSegmentId} />

      {/* Active widgets */}
      {actives.length > 0 && (
        <>
          <SectionHeading label="Active" count={actives.length} />
          {actives.map((w) => <InspectorWidgetRow key={w.id} uw={w} />)}
        </>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <>
          <SectionHeading label="Suggestions" count={suggestions.length} />
          {suggestions.map((w) => <InspectorWidgetRow key={w.id} uw={w} />)}
        </>
      )}

      {/* Segments — chip cloud */}
      {masksIndex.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-wide text-text-secondary mt-3.5 mb-1.5">
            Segments · {masksIndex.length}
          </div>
          <div className="flex flex-wrap gap-1">
            {masksIndex.map((m) => {
              const sel = selectedSegmentId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => useSegmentSelection.setState({ selectedSegmentId: m.id })}
                  className={
                    'px-1.5 py-px rounded-full text-[9px] ' +
                    (sel ? 'bg-accent text-white font-semibold' : 'bg-surface-secondary text-text-primary hover:bg-surface-secondary/80')
                  }
                >{m.label ?? m.id.slice(0, 6)}</button>
              );
            })}
          </div>
        </>
      )}

    </div>
  );
}

export const InspectorPanelBody = InspectorPanel;

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-[9px] uppercase tracking-wide text-text-secondary mt-3.5 mb-1 pb-0.5 border-b border-separator">
      {label} · {count}
    </div>
  );
}

function SelectionRow({ maskId }: { maskId: string | null }) {
  if (!maskId) {
    return (
      <div className="text-[10px] text-text-secondary px-1.5 py-1">
        Click a segment to scope tools and prompts.
      </div>
    );
  }
  const mask = maskStore.get(maskId);
  if (!mask) {
    return <div className="text-[10px] text-text-secondary px-1.5 py-1">Resolving segment…</div>;
  }
  let setPixels = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) setPixels++;
  const totalPixels = mask.width * mask.height;
  const pct = totalPixels > 0 ? Math.round((setPixels / totalPixels) * 100) : 0;
  return (
    <div className="flex items-center gap-2 px-1.5 py-1 text-[10px]">
      <span className="text-[8px] uppercase tracking-wide text-text-secondary">Sel</span>
      <span className="bg-accent text-white px-1.5 py-px rounded-full text-[9px] font-semibold">
        {mask.label ?? 'segment'}
      </span>
      <span className="text-text-secondary text-[9px]">{pct}%</span>
    </div>
  );
}
