import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { ScrollArea } from '@/components/ui/ScrollArea';
import type { ProcessingDefinition } from '@/types/processing';
import type { Widget } from '@/types/widget';
import { ToolSection } from './ToolSection';
import { AiSection } from './AiSection';

// Stable empty reference so the selector below doesn't return a fresh literal
// each render (avoids useSyncExternalStore re-render churn when snapshot is null).
const EMPTY_WIDGETS: Widget[] = [];

// Per-def label overrides for the accordion. Most defs use their own `.label`
// directly; a few need a slightly different toolrail-style name here. Empty
// today now that "White Balance" is the canonical name for the kelvin def.
const SECTION_LABELS: Record<string, string> = {
  filter: 'Filters',
};

// Tool grouping. Each inner array is a contiguous group of rows; only the
// gaps BETWEEN groups get a separator. Within a group rows have no internal
// dividers. Order inside a group is user-friendly (not registration order).
//   1) Tonal / luminance shaping
//   2) Colour
//   3) Detail
//   4) Finishing effects
//   5) Filter presets (LUTs)
const TOOL_GROUPS: string[][] = [
  ['light', 'levels', 'curves'],
  ['color', 'kelvin', 'hsl'],
  ['sharpen', 'clarity', 'blur'],
  ['splitTone', 'vignette', 'grain'],
  ['filter'],
];

function sectionDef(def: ProcessingDefinition): ProcessingDefinition {
  const label = SECTION_LABELS[def.id];
  return label && label !== def.label ? { ...def, label } : def;
}

export function AdjustmentsAccordion() {
  const layerId = useEditorStore((s) => s.activeLayerId);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  // Pending suggestions are gated by the SuggestionChips row at the top of
  // the editor; hide them from the inspector AI section so they don't appear
  // anywhere until the user has clicked Allow.
  const pendingIds = useBackendState((s) => s.pendingSuggestionIds);
  const aiWidgets = widgets.filter(
    (w) =>
      (w.status === 'active' || w.status === 'accepted') &&
      w.origin.kind === 'mcp_autonomous' &&
      !pendingIds.has(w.id),
  );

  // Build the ordered list of (def, isLastInGroup) tuples so the renderer can
  // decide where to drop separators. Defs not in TOOL_GROUPS are ignored —
  // adding a new processing def requires adding it to a group explicitly.
  const allDefs = new Map(
    [
      ...ProcessingRegistry.getByCategory('adjust'),
      ...ProcessingRegistry.getByCategory('filter'),
    ].map((d) => [d.id, d]),
  );
  const groups = TOOL_GROUPS.map((ids) =>
    ids.map((id) => allDefs.get(id)).filter((d): d is ProcessingDefinition => Boolean(d)),
  ).filter((g) => g.length > 0);

  return (
    <ScrollArea className="flex-1 min-h-0">
      {aiWidgets.length > 0 && (
        <div className="px-2.5 pt-2 pb-3 flex flex-col gap-2">
          <div className="text-[9px] uppercase tracking-wide text-text-secondary">
            AI Suggestions
          </div>
          {aiWidgets.map((w) => (
            <AiSection key={w.id} widget={w} />
          ))}
        </div>
      )}
      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2.5 pt-2 pb-1">
        Tools
      </div>
      {groups.map((group, gi) => (
        <div
          key={gi}
          className={gi < groups.length - 1 ? 'border-b border-separator' : ''}
        >
          {group.map((def) => (
            <ToolSection key={def.id} def={sectionDef(def)} layerId={layerId} />
          ))}
        </div>
      ))}
    </ScrollArea>
  );
}
