import { ChevronRight, ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { sectionSummary } from './section-summary';
import { ScalarSectionBody } from './ScalarSectionBody';
import { CurvesSectionBody } from './CurvesSectionBody';
import { PromoteOnlyBody } from './PromoteOnlyBody';

interface ToolSectionProps {
  def: ProcessingDefinition;
  layerId: string | null;
}

export function ToolSection({ def, layerId }: ToolSectionProps) {
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(def.id));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const canonical = useBackendState((s) => {
    const id = layerId ? `canon:${layerId}:${def.adjustmentType}` : '';
    return (s.snapshot?.operation_graph.nodes.find((n) => n.id === id)?.params ?? {}) as Record<string, unknown>;
  });
  const { summary, dirty } = sectionSummary(def.params, canonical);
  const Icon = def.icon;

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => toggle(def.id)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <Icon size={14} />
        <span className="flex-1 text-xs font-medium text-text-primary">{def.label}</span>
        {!expanded && <span className="text-[10px] text-text-secondary num">{summary}</span>}
        {!expanded && dirty && <span data-testid="dirty-dot" className="w-1.5 h-1.5 rounded-full bg-accent" />}
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && layerId && (
        def.adjustmentType === 'curves' ? (
          <CurvesSectionBody layerId={layerId} />
        ) : def.adjustmentType === 'lut' ? (
          <PromoteOnlyBody toolId={def.id} />
        ) : (
          <ScalarSectionBody layerId={layerId} op={def.adjustmentType} params={def.params} />
        )
      )}
    </div>
  );
}
