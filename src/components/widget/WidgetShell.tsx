import { useEffect, useRef, useState } from 'react';
import type { Widget, MaskSummary } from '@/types/widget';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useWidgetExpansion } from '@/hooks/useWidgetExpansion';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { useEditorStore } from '@/store';
import { bindingProvenance, touchKey } from '@/hooks/useParamProvenance';
import { engineNeutralForBinding } from '@/engine/registry';
import { WidgetShellHeader } from './WidgetShellHeader';
import { RefineInput } from './RefineInput';
import { WhyPopover } from './WhyPopover';
import { BindingRow } from '@/components/inspector/widget/BindingRow';
import { HslWidgetBody, isHslWidget } from './HslWidgetBody';
import { LevelsWidgetBody, isFullLevelsWidget } from './LevelsWidgetBody';
import { CurvesWidgetBody, isCurvesWidget } from './CurvesWidgetBody';
import { CompoundWidgetBody } from './CompoundWidgetBody';
import { WidgetAutoButton } from './WidgetAutoButton';
import { loadRegistry } from '@/lib/registry/loader';

/**
 * Minimum WidgetShell width in CSS pixels. The shell grows past this to fit
 * its content when expanded.
 */
export const WIDGET_SHELL_MIN_WIDTH = 226;

// Fixed width for collapsed pill state. Matches WIDGET_SHELL_MIN_WIDTH so
// transitioning collapsed → expanded doesn't change horizontal footprint.
// Long titles truncate with ellipsis (.widget-title-ellipsis utility).
export const WIDGET_COLLAPSED_WIDTH = 226;

interface WidgetShellProps {
  widget: Widget;
  selected?: boolean;
}

const EMPTY_MASKS: MaskSummary[] = [];

export function WidgetShell({ widget, selected = false }: WidgetShellProps) {
  const { isExpanded, toggle } = useWidgetExpansion(widget.id);
  const { hoveredWidgetId, setHoveredWidget } = useHoveredWidget();
  const sessionId = useBackendState((s) => s.sessionId);
  const optimistic = useBackendState((s) => s.optimistic);
  const masks = useBackendState((s) => s.snapshot?.masksIndex ?? EMPTY_MASKS);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const touched = useEditorStore((s) => s.touchedParams);

  const hidden = useEditorStore((s) => s.hiddenWidgetIds.has(widget.id));
  const toggleHidden = useEditorStore((s) => s.toggleWidgetHidden);
  // When the user pinned a single slider, only that binding key is shown on
  // the canvas. The widget's other bindings still exist (the inspector still
  // edits them) — this is a per-shell display filter.
  const pinnedParamKeys = useEditorStore((s) => s.pinnedWidgetParams[widget.id]);
  const visibleBindings = pinnedParamKeys && pinnedParamKeys.length > 0
    ? widget.bindings.filter((b) => pinnedParamKeys.includes(b.paramKey))
    : widget.bindings;

  const showAiAffordances = widget.origin.kind !== 'tool_invoked';

  const [whyOpen, setWhyOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePending, setRefinePending] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const hovered = hoveredWidgetId === widget.id;

  // Optimistic patches are keyed by the CANONICAL op-graph node id
  // (`canon:<layer>:<op>`) — that's what `useImageNodeRender` reads from
  // when applying overrides to op_graph nodes. The widget's own node id
  // (`n_<hex>`) never appears in the canonical graph, so keying by it
  // would correctly bump the slider position in JS state but leave the
  // rendered pixels waiting for the SSE roundtrip — felt laggy.
  function canonIdFor(b: Widget['bindings'][number]): string {
    const node = widget.nodes.find((n) => n.id === b.target.nodeId);
    return node ? `canon:${node.layerId}:${node.type}` : b.target.nodeId;
  }
  function readOptimistic(b: Widget['bindings'][number]): Widget['bindings'][number]['value'] | undefined {
    const patch = optimistic.get(canonIdFor(b));
    if (!patch) return undefined;
    const p = patch.bindings.find((p) => p.paramKey === b.target.paramKey);
    return p?.value;
  }

  // dirty: any binding diverges from default (optimistic-aware)
  const dirty = widget.bindings.some((b) => {
    const opt = readOptimistic(b);
    const effective = opt !== undefined ? opt : b.value;
    return effective !== b.default;
  });

  function setParam(paramKey: string, value: Widget['bindings'][number]['value']) {
    if (!sessionId || offline) return;
    const binding = widget.bindings.find((b) => b.paramKey === paramKey);
    if (binding) {
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      // Key the optimistic patch by canonical id so the WebGL render pass
      // picks it up immediately — see canonIdFor() above.
      useBackendState.getState().applyOptimistic(canonIdFor(binding), {
        bindings: [{ paramKey: binding.target.paramKey, value }],
        baseRevision,
      });
      const node = widget.nodes.find((n) => n.id === binding.target.nodeId);
      if (node?.layerId) {
        useEditorStore.getState().markParamTouched(touchKey(node.layerId, node.type, binding.target.paramKey));
      }
    }
    void backendTools.set_widget_param(sessionId, { widgetId: widget.id, paramKey, value });
  }

  function handleApply() {
    if (!sessionId || offline) return;
    void backendTools.accept_widget(sessionId, { widgetId: widget.id });
  }

  function handleClose() {
    if (!sessionId || offline) return;
    void backendTools.delete_widget(sessionId, { widgetId: widget.id, suppressSimilar: false });
  }

  function handleReset() {
    for (const b of widget.bindings) setParam(b.paramKey, b.default);
  }

  function handleRefineSubmit(instruction: string) {
    if (!sessionId || offline) return;
    setRefinePending(true);
    void backendTools
      .refine_widget(sessionId, { widgetId: widget.id, instruction, edits: [], additions: [] })
      .finally(() => {
        if (!mountedRef.current) return;
        setRefinePending(false);
        setRefineOpen(false);
      });
  }

  function effectiveValue(b: Widget['bindings'][number]) {
    const opt = readOptimistic(b);
    return opt !== undefined ? opt : b.value;
  }

  return (
    <div
      // Collapsed: fixed 226px pill (WIDGET_COLLAPSED_WIDTH) — no stretching for long titles.
      // Expanded: min-width only, body grows to fit controls.
      // AI-composed widgets get a violet outline + glow (widget-shell-ai) so
      // they read as distinct from tool-invoked widgets on the canvas.
      className={`overlay w-fit ${showAiAffordances ? 'widget-shell-ai' : ''} ${selected && !showAiAffordances ? 'workspace-node-selected' : ''} ${hovered ? 'border-accent' : ''} ${hidden ? 'opacity-60' : ''}`}
      style={
        isExpanded
          ? { minWidth: `${WIDGET_SHELL_MIN_WIDTH}px` }
          : { width: `${WIDGET_COLLAPSED_WIDTH}px` }
      }
      onMouseEnter={() => setHoveredWidget(widget.id)}
      onMouseLeave={() => setHoveredWidget(null)}
    >
      <WidgetShellHeader
        widget={widget}
        expanded={isExpanded}
        dirty={dirty}
        hidden={hidden}
        onToggle={toggle}
        onClose={handleClose}
        onToggleHidden={() => toggleHidden(widget.id)}
        onRefine={() => setRefineOpen((v) => !v)}
        onWhy={() => setWhyOpen((v) => !v)}
        onReset={handleReset}
        onApply={handleApply}
        applyDisabled={offline}
        showAiAffordances={showAiAffordances}
        whyButton={
          <WhyPopover open={whyOpen} widget={widget} onOpenChange={setWhyOpen}>
            <button
              type="button"
              aria-label="Explain widget"
              title="Why? — explain this widget's reasoning"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center size-4 rounded-[3px]
                text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
            >
              <span aria-hidden className="inline-block leading-none font-semibold text-[12px] -mt-px">
                ?
              </span>
            </button>
          </WhyPopover>
        }
      />
      {isExpanded && (
        <>
          {/* Inline reasoning banner removed — the footer's "Why?" button
              already exposes the same string in a popover. */}
          {/* When a single-param pin filter is active, fall through to the
              flat BindingRow list regardless of widget shape — the rich
              bodies (HSL band rail, Levels histogram, Curves editor) expect
              all bindings to be present, so they're skipped here. */}
          {!pinnedParamKeys && loadRegistry().ops[widget.opId ?? '']?.compound && (
            <div className="px-1.5 py-1">
              <CompoundWidgetBody widget={widget} />
            </div>
          )}
          {!pinnedParamKeys && widget.bindings.length > 0 && isHslWidget(widget) && (
            <div className="px-1.5 py-1">
              <HslWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {!pinnedParamKeys && widget.bindings.length > 0 && isFullLevelsWidget(widget) && (
            <div className="px-1.5 py-1">
              <LevelsWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {!pinnedParamKeys && widget.bindings.length > 0 && isCurvesWidget(widget) && (
            <div className="py-1">
              <CurvesWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {widget.bindings.length > 0 && (pinnedParamKeys || (!loadRegistry().ops[widget.opId ?? '']?.compound && !isHslWidget(widget) && !isFullLevelsWidget(widget) && !isCurvesWidget(widget))) && (
            <div className="flex flex-col gap-1.5 px-1.5 py-1">
              {/* Auto-tune pill: mechanical-only baseline values for the
                  current op. Renders only when the op has an auto recipe
                  (light / color / kelvin / levels) — silent otherwise. */}
              {visibleBindings.length === widget.bindings.length && (
                <WidgetAutoButton widget={widget} setParam={(k, v) => setParam(k, v)} />
              )}
              {visibleBindings.map((b) => {
                const eff = effectiveValue(b);
                const node = widget.nodes.find((n) => n.id === b.target.nodeId);
                const isTouched = node?.layerId
                  ? touched.has(touchKey(node.layerId, node.type, b.target.paramKey))
                  : false;
                // Engine neutral feeds the provenance check so an AI
                // slider reads VIOLET while still resting at the AI's
                // resolved value (= binding.default, ≠ engine 0). User
                // touch flips it to ACCENT (blue).
                const neutral = engineNeutralForBinding(b);
                return (
                  <BindingRow
                    key={b.paramKey}
                    binding={b}
                    effectiveValue={eff}
                    maskSummaries={masks}
                    onChange={(value) => setParam(b.paramKey, value)}
                    provenance={bindingProvenance(
                      eff,
                      b.default,
                      widget.origin.kind !== 'tool_invoked',
                      isTouched,
                      neutral,
                    )}
                  />
                );
              })}
            </div>
          )}
          {refineOpen && (
            <RefineInput
              onSubmit={handleRefineSubmit}
              onCancel={() => setRefineOpen(false)}
              pending={refinePending}
            />
          )}
        </>
      )}
    </div>
  );
}
