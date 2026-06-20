import { ChevronRight, ChevronDown, Pin, Eye, EyeOff, RotateCcw, Wand2 } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { loadRegistry } from '@/lib/registry/loader';
import { backendTools } from '@/lib/backend-tools';
import { sectionSummary } from './section-summary';
import { IDENTITY_CURVES, isIdentityCurves, type CurvesValue } from '@/types/curve';
import { ScalarSectionBody } from './ScalarSectionBody';
import { RegistryDrivenSectionBody } from './RegistryDrivenSectionBody';
import { CurvesSectionBody } from './CurvesSectionBody';
import { PromoteOnlyBody } from './PromoteOnlyBody';
import { HslSectionBody } from './HslSectionBody';
import { LevelsSectionBody } from './LevelsSectionBody';
import { HslOpenOnCanvasButton } from './HslOpenOnCanvasButton';
import { promoteToCanvas } from './promote';
import { CompoundWidgetBody } from '@/components/widget/CompoundWidgetBody';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { autoParamsForOp } from '@/lib/auto-tune';

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
    return (s.snapshot?.operationGraph.nodes.find((n) => n.id === id)?.params ?? EMPTY_PARAMS) as Record<string, unknown>;
  });
  // For compound ops: locate the active widget from the snapshot so the generic
  // CompoundWidgetBody can drive the dial + anchor cards. Only used when the
  // registry op has a `compound` block AND a matching widget exists.
  const compoundWidget = useBackendState((s) => {
    if (!layerId) return null;
    const op = loadRegistry().ops[def.id];
    if (!op?.compound) return null;
    return s.snapshot?.widgets.find(
      (w) => w.opId === def.id &&
        w.status === 'active' &&
        w.nodes.some((n) => n.layerId === layerId),
    ) ?? null;
  });
  // For curves the section has no scalar params — the touched signal is binary
  // (curves are at identity, or they're not). Roll that into touchedCount so
  // the section header gets the same ↺ N reset badge other ops show.
  const isCurves = def.adjustmentType === 'curves';
  const curvesValue = isCurves ? (canonical.curves as CurvesValue | undefined) : undefined;
  const curvesTouched = isCurves && !isIdentityCurves(curvesValue);
  const { touchedCount: scalarTouched } = sectionSummary(def.params, canonical);
  const touchedCount = scalarTouched + (curvesTouched ? 1 : 0);
  const Icon = def.icon;
  const isHsl = def.adjustmentType === 'hsl';
  const promoteDisabled = offline || !layerId;
  const canonId = layerId ? `canon:${layerId}:${def.adjustmentType}` : null;
  const hidden = useEditorStore((s) => (canonId ? s.hiddenCanonNodeIds.has(canonId) : false));
  const toggleCanonHidden = useEditorStore((s) => s.toggleCanonNodeHidden);

  // Auto-tune support (mechanical-only — light / color / kelvin / levels).
  // Renders the small "Auto" pill in the section header when both:
  //   1. The op has a recipe in `autoParamsForOp`.
  //   2. A live mechanical snapshot exists (image rendered to canvas).
  const mech = useLiveMechanicalContext();
  const autoRecipeOps = new Set(['light', 'color', 'kelvin', 'levels']);
  const hasAutoRecipe = autoRecipeOps.has(def.id);
  const autoDisabled = !mech || offline || !layerId;

  function handleAuto(e: React.MouseEvent) {
    e.stopPropagation();
    if (autoDisabled || !mech || !layerId || !sessionId) return;
    const params = autoParamsForOp(def.id, mech);
    if (!params) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    for (const [paramKey, value] of Object.entries(params)) {
      // Only push params present in the op's binding set.
      if (!def.params.some((p) => p.key === paramKey)) continue;
      useBackendState.getState().applyOptimistic(`canon:${layerId}:${def.adjustmentType}`, {
        bindings: [{ paramKey, value }], baseRevision,
      });
      void backendTools.set_param(sessionId, {
        layerId, op: def.adjustmentType, param: paramKey, value,
      });
    }
  }

  function handleReset(e: React.MouseEvent) {
    e.stopPropagation();
    if (offline || !layerId || !sessionId) return;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    if (isCurves) {
      // Curves has no scalar params — the canonical node carries a single
      // structured `curves` value. Reset it to identity in one shot.
      useBackendState.getState().applyOptimistic(`canon:${layerId}:curves`, {
        bindings: [{ paramKey: 'curves', value: IDENTITY_CURVES }], baseRevision,
      });
      void backendTools.set_param(sessionId, {
        layerId, op: 'curves', param: 'curves', value: IDENTITY_CURVES,
      });
      return;
    }
    for (const p of def.params) {
      useBackendState.getState().applyOptimistic(`canon:${layerId}:${def.adjustmentType}`, {
        bindings: [{ paramKey: p.key, value: p.default as number }], baseRevision,
      });
      void backendTools.set_param(sessionId, {
        layerId, op: def.adjustmentType, param: p.key, value: p.default as number,
      });
    }
  }

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
        </button>
        {/* Touched-count badge consolidates with Reset: clicking it resets
            every param in the section to its default. Styled like the other
            row icons (Eye / Promote) for visual rhythm. The count rides next
            to the icon as a tiny digit — informational, not chip-shaped. */}
        {touchedCount > 0 && (
          <button
            type="button"
            data-testid="touched-count"
            onClick={handleReset}
            disabled={offline || !layerId}
            title={`Reset ${touchedCount} adjustment${touchedCount === 1 ? '' : 's'} to default`}
            aria-label={`Reset ${touchedCount} adjustments`}
            className="inline-flex items-center gap-0.5 text-text-secondary
              hover:text-text-primary hover:bg-surface-secondary
              p-0.5 rounded-[3px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={13} aria-hidden />
            <span className="text-[10px] tabular-nums leading-none pr-0.5">{touchedCount}</span>
          </button>
        )}
        {/* Auto-tune — mechanical, no LLM. Hidden for ops without a recipe
            (curves / hsl / sharpen / etc.). Renders disabled until the live
            mechanical snapshot is ready. Same icon-button shape as Eye /
            Promote so the row stays consistent. */}
        {hasAutoRecipe && (
          <button
            type="button"
            onClick={handleAuto}
            disabled={autoDisabled}
            title={
              !mech
                ? 'Mechanical analysis not ready yet'
                : 'Set sliders to mechanically-derived starting values (Auto)'
            }
            aria-label="Auto-tune"
            className="inline-flex items-center text-text-secondary
              hover:text-text-primary hover:bg-surface-secondary
              p-0.5 rounded-[3px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 size={13} aria-hidden />
          </button>
        )}
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
            aria-label="Pin to canvas"
            title="Pin to canvas"
            className="inline-flex items-center text-text-secondary hover:text-text-primary hover:bg-surface-secondary p-0.5 rounded-[3px] disabled:opacity-40"
          >
            <Pin size={13} aria-hidden />
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
          <ScalarSectionBody toolId={def.id} layerId={layerId} op={def.adjustmentType} params={def.params} />
        )
      )}
    </div>
  );
}
