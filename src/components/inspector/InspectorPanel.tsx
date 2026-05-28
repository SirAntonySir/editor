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
  // Returns a stable signature string (same input → same string → no re-render);
  // length alone misses removeAdjustment when the layer count doesn't change.
  useEditorStore((s) =>
    s.layers.map((l) => `${l.id}:${l.adjustmentStack.adjustments.length}`).join('|'),
  );

  const all = selectAllWidgets();
  const suggestions = all.filter((w) =>
    w.variant === 'ai' && w._widget?.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );
  const actives = all.filter((w) => !suggestions.includes(w));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">

      {/* Selection */}
      <section className="rounded-md bg-surface border-l-2 border-accent px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-text-secondary mb-1">Selection</div>
        {selectedSegmentId ? (
          <SelectionCard maskId={selectedSegmentId} />
        ) : (
          <div className="text-[11px] text-text-secondary">Click a segment on the canvas to scope tools and prompts.</div>
        )}
      </section>

      {/* Active widgets */}
      {actives.length > 0 && (
        <section className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wide text-text-secondary flex justify-between mb-1">
            <span>Active widgets</span><span>{actives.length}</span>
          </div>
          {actives.map((w) => <InspectorWidgetRow key={w.id} uw={w} />)}
        </section>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <section className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wide text-text-secondary flex justify-between mb-1">
            <span>Suggestions</span><span>{suggestions.length}</span>
          </div>
          {suggestions.map((w) => <InspectorWidgetRow key={w.id} uw={w} />)}
        </section>
      )}

      {/* Segments */}
      {masksIndex.length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-wide text-text-secondary flex justify-between mb-2">
            <span>Segments</span><span>{masksIndex.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {masksIndex.map((m) => {
              const sel = selectedSegmentId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => useSegmentSelection.setState({ selectedSegmentId: m.id })}
                  className={
                    'px-2 py-0.5 rounded-full text-[10px] ' +
                    (sel ? 'bg-accent text-white' : 'bg-surface-secondary text-text-primary hover:bg-surface-secondary/80')
                  }
                >{m.label ?? m.id.slice(0, 6)}</button>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}

// Re-export under the old name so any leftover importer of InspectorPanelBody still works.
export const InspectorPanelBody = InspectorPanel;

function SelectionCard({ maskId }: { maskId: string }) {
  const mask = maskStore.get(maskId);
  if (!mask) return <div className="text-[11px] text-text-secondary">Resolving segment…</div>;
  let setPixels = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) setPixels++;
  const totalPixels = mask.width * mask.height;
  const pct = totalPixels > 0 ? (setPixels / totalPixels) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm font-medium text-text-primary">{mask.label ?? 'segment'}</div>
      <div className="text-[10px] text-text-secondary">
        {pct.toFixed(0)}% of image · {setPixels.toLocaleString()} px
      </div>
    </div>
  );
}
