import { useEffect } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';
import type { ProcessingDefinition } from '@/types/processing';
import type { Widget } from '@/types/widget';
import { ToolSection } from './ToolSection';
import { AiSection } from './AiSection';
import { ColourBandToolRow } from './ColourBandToolRow';

// Stable empty reference so the selector below doesn't return a fresh literal
// each render (avoids useSyncExternalStore re-render churn when snapshot is null).
const EMPTY_WIDGETS: Widget[] = [];

// Per-def label overrides for the accordion. Most defs use their own `.label`
// directly; a few need a slightly different toolrail-style name here. Empty
// today now that "White Balance" is the canonical name for the kelvin def.
const SECTION_LABELS: Record<string, string> = {
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

  // Auto-pop AI suggestions onto the canvas: each autonomous suggestion gets a
  // tethered canvas shell the first time it appears (the old engage-on-click
  // step is now automatic). Guarded by acceptedSuggestions so it tethers once.
  const aiKey = aiWidgets.map((w) => w.id).join(',');
  useEffect(() => {
    if (!aiKey) return;
    const bs = useBackendState.getState();
    for (const id of aiKey.split(',')) {
      if (bs.acceptedSuggestions.has(id)) continue;
      const w = bs.snapshot?.widgets.find((x) => x.id === id);
      if (!w) continue;
      bs.addAcceptedSuggestion(id);
      tetherWorkspaceWidgetOnEngage(w);
    }
  }, [aiKey]);

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
      <ColourBandToolRow />
    </div>
  );
}
