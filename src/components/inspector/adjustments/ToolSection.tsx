import { ChevronRight, ChevronDown, ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { loadRegistry } from '@/lib/registry/loader';
import { sectionSummary } from './section-summary';
import { ScalarSectionBody } from './ScalarSectionBody';
import { RegistryDrivenSectionBody } from './RegistryDrivenSectionBody';
import { CurvesSectionBody } from './CurvesSectionBody';
import { PromoteOnlyBody } from './PromoteOnlyBody';
import { HslSectionBody } from './HslSectionBody';
import { LevelsSectionBody } from './LevelsSectionBody';
import { HslOpenOnCanvasButton } from './HslOpenOnCanvasButton';
import { promoteToCanvas } from './promote';
import { CompoundWidgetBody } from '@/components/widget/CompoundWidgetBody';

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
  // For compound ops: locate the active widget from the snapshot so the generic
  // CompoundWidgetBody can drive the dial + anchor cards. Only used when the
  // registry op has a `compound` block AND a matching widget exists.
  const compoundWidget = useBackendState((s) => {
    if (!layerId) return null;
    const op = loadRegistry().ops[def.id];
    if (!op?.compound) return null;
    return s.snapshot?.widgets.find(
      (w) => w.op_id === def.id &&
        w.status === 'active' &&
        w.nodes.some((n) => n.layer_id === layerId),
    ) ?? null;
  });
  const { touchedCount } = sectionSummary(def.params, canonical);
  const Icon = def.icon;
  const isHsl = def.adjustmentType === 'hsl';
  const promoteDisabled = offline || !layerId;
  const canonId = layerId ? `canon:${layerId}:${def.adjustmentType}` : null;
  const hidden = useEditorStore((s) => (canonId ? s.hiddenCanonNodeIds.has(canonId) : false));
  const toggleCanonHidden = useEditorStore((s) => s.toggleCanonNodeHidden);

  // No `border-b` here anymore — separators are owned by the accordion as
  // group dividers, not per-tool. See AdjustmentsAccordion.
  return (
    <div className={hidden ? 'opacity-60' : undefined}>
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
        <button
          type="button"
          disabled={!canonId}
          aria-label={hidden ? 'Show tool adjustment' : 'Hide tool adjustment'}
          onClick={() => { if (canonId) toggleCanonHidden(canonId); }}
          className="inline-flex items-center text-text-secondary hover:text-text-primary hover:bg-surface-secondary p-0.5 rounded-[3px] disabled:opacity-40"
        >
          {hidden ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
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
        ) : def.adjustmentType === 'levels' ? (
          <LevelsSectionBody layerId={layerId} />
        ) : def.adjustmentType === 'lut' ? (
          <PromoteOnlyBody toolId={def.id} />
        ) : compoundWidget ? (
          // Generic compound body — fires for any registry op with a `compound`
          // block that has an active widget, including time-of-day.
          <CompoundWidgetBody widget={compoundWidget} />
        ) : loadRegistry().ops[def.id] ? (
          <RegistryDrivenSectionBody
            defId={def.id}
            opType={def.adjustmentType}
            layerId={layerId}
            params={def.params}
          />
        ) : (
          <ScalarSectionBody layerId={layerId} op={def.adjustmentType} params={def.params} />
        )
      )}
    </div>
  );
}
