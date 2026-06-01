import { ChevronRight, ChevronDown, ArrowUpRight } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { sectionSummary } from './section-summary';
import { ScalarSectionBody } from './ScalarSectionBody';
import { CurvesSectionBody } from './CurvesSectionBody';
import { PromoteOnlyBody } from './PromoteOnlyBody';
import { HslSectionBody } from './HslSectionBody';
import { HslOpenOnCanvasButton } from './HslOpenOnCanvasButton';
import { promoteToCanvas } from './promote';

interface ToolSectionProps {
  def: ProcessingDefinition;
  layerId: string | null;
}

const EMPTY_PARAMS: Record<string, unknown> = {};

export function ToolSection({ def, layerId }: ToolSectionProps) {
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(def.id));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const canonical = useBackendState((s) => {
    const id = layerId ? `canon:${layerId}:${def.adjustmentType}` : '';
    return (s.snapshot?.operation_graph.nodes.find((n) => n.id === id)?.params ?? EMPTY_PARAMS) as Record<string, unknown>;
  });
  const { touchedCount } = sectionSummary(def.params, canonical);
  const Icon = def.icon;
  const isHsl = def.adjustmentType === 'hsl';
  const promoteDisabled = offline || !layerId;

  // No `border-b` here anymore — separators are owned by the accordion as
  // group dividers, not per-tool. See AdjustmentsAccordion.
  return (
    <div>
      <div className="w-full flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={() => toggle(def.id)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          {/* Chevron leads the row so the disclosure state is the first thing
              the eye lands on, before the icon and label. */}
          <span className="text-text-secondary inline-flex items-center w-3">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <Icon size={14} />
          <span className="flex-1 truncate text-xs font-medium text-text-primary">{def.label}</span>
          {/* Count badge replaces the old inline edit-list + dirty dot.
              Hidden when nothing is touched, so no "—" placeholder needed. */}
          {touchedCount > 0 && (
            <span
              data-testid="touched-count"
              title={`${touchedCount} adjustment${touchedCount === 1 ? '' : 's'} touched`}
              className="text-[9px] tabular-nums px-1.5 py-px rounded-full bg-accent/15 text-accent font-medium leading-none"
            >
              {touchedCount}
            </span>
          )}
        </button>
        {isHsl ? (
          <HslOpenOnCanvasButton
            sessionId={sessionId}
            layerId={layerId}
            disabled={promoteDisabled}
          />
        ) : (
          <button
            type="button"
            disabled={promoteDisabled}
            onClick={() => promoteToCanvas(sessionId, def.id, layerId)}
            aria-label="Open on canvas"
            title="Open on canvas"
            className="inline-flex items-center text-text-secondary hover:text-text-primary hover:bg-surface-secondary p-0.5 rounded-[3px] disabled:opacity-40"
          >
            <ArrowUpRight size={13} aria-hidden />
          </button>
        )}
      </div>
      {expanded && layerId && (
        def.adjustmentType === 'curves' ? (
          <CurvesSectionBody layerId={layerId} />
        ) : def.adjustmentType === 'hsl' ? (
          <HslSectionBody layerId={layerId} />
        ) : def.adjustmentType === 'lut' ? (
          <PromoteOnlyBody toolId={def.id} />
        ) : (
          <ScalarSectionBody layerId={layerId} op={def.adjustmentType} params={def.params} />
        )
      )}
    </div>
  );
}
