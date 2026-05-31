import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { ProcessingDefinition } from '@/types/processing';
import type { Widget } from '@/types/widget';
import { ToolSection } from './ToolSection';
import { AiSection } from './AiSection';

// Stable empty reference so the selector below doesn't return a fresh literal
// each render (avoids useSyncExternalStore re-render churn when snapshot is null).
const EMPTY_WIDGETS: Widget[] = [];

// Canonical toolrail display names (CLAUDE.md: 6-button toolrail). A handful of
// processing defs carry a longer descriptive label (e.g. 'White Balance') than
// the short toolrail name shown in the rail; map by def id where they differ.
const SECTION_LABELS: Record<string, string> = {
  kelvin: 'Kelvin',
  filter: 'Filters',
};

function sectionDef(def: ProcessingDefinition): ProcessingDefinition {
  const label = SECTION_LABELS[def.id];
  return label && label !== def.label ? { ...def, label } : def;
}

export function AdjustmentsAccordion() {
  const layerId = useEditorStore((s) => s.activeLayerId);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const aiWidgets = widgets.filter(
    (w) => (w.status === 'active' || w.status === 'accepted') && w.origin.kind === 'mcp_autonomous',
  );
  // Toolrail tools: the 5 'adjust' defs plus the LUT 'filter' def, in
  // registration order (light, color, kelvin, curves, levels, filters).
  const tools = [
    ...ProcessingRegistry.getByCategory('adjust'),
    ...ProcessingRegistry.getByCategory('filter'),
  ];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {aiWidgets.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2.5 pt-2 pb-1">
            AI Suggestions
          </div>
          {aiWidgets.map((w) => (
            <AiSection key={w.id} widget={w} />
          ))}
        </>
      )}
      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-2.5 pt-2 pb-1">
        Tools
      </div>
      {tools.map((def) => (
        <ToolSection key={def.id} def={sectionDef(def)} layerId={layerId} />
      ))}
    </div>
  );
}
