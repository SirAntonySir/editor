import { useEffect, useRef, useState } from 'react';
import type { Widget, MaskSummary } from '@/types/widget';
import { HelpCircle } from 'lucide-react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useWidgetExpansion } from '@/hooks/useWidgetExpansion';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { useEditorStore } from '@/store';
import { bindingProvenance, touchKey } from '@/hooks/useParamProvenance';
import { engineNeutralForBinding } from '@/engine/registry';
import { useZoomInvariantScale } from './useZoomInvariantScale';
import { WidgetShellHeader } from './WidgetShellHeader';
import { WidgetShellFooter } from './WidgetShellFooter';
import { RefineInput } from './RefineInput';
import { WhyPopover } from './WhyPopover';
import { BindingRow } from '@/components/inspector/widget/BindingRow';
import { HslWidgetBody, isHslWidget } from './HslWidgetBody';
import { LevelsWidgetBody, isFullLevelsWidget } from './LevelsWidgetBody';
import { TimeOfDayWidgetBody } from '@/components/workspace/TimeOfDayWidgetBody';

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
  const zoomInverse = useZoomInvariantScale();
  const { hoveredWidgetId, setHoveredWidget } = useHoveredWidget();
  const sessionId = useBackendState((s) => s.sessionId);
  const optimistic = useBackendState((s) => s.optimistic);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const touched = useEditorStore((s) => s.touchedParams);

  const hidden = useEditorStore((s) => s.hiddenWidgetIds.has(widget.id));
  const toggleHidden = useEditorStore((s) => s.toggleWidgetHidden);

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
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    return node ? `canon:${node.layer_id}:${node.type}` : b.target.node_id;
  }
  function readOptimistic(b: Widget['bindings'][number]): Widget['bindings'][number]['value'] | undefined {
    const patch = optimistic.get(canonIdFor(b));
    if (!patch) return undefined;
    const p = patch.bindings.find((p) => p.paramKey === b.target.param_key);
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
    const binding = widget.bindings.find((b) => b.param_key === paramKey);
    if (binding) {
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      // Key the optimistic patch by canonical id so the WebGL render pass
      // picks it up immediately — see canonIdFor() above.
      useBackendState.getState().applyOptimistic(canonIdFor(binding), {
        bindings: [{ paramKey: binding.target.param_key, value }],
        baseRevision,
      });
      const node = widget.nodes.find((n) => n.id === binding.target.node_id);
      if (node?.layer_id) {
        useEditorStore.getState().markParamTouched(touchKey(node.layer_id, node.type, binding.target.param_key));
      }
    }
    void backendTools.set_widget_param(sessionId, { widget_id: widget.id, param_key: paramKey, value });
  }

  function handleApply() {
    if (!sessionId || offline) return;
    void backendTools.accept_widget(sessionId, { widget_id: widget.id });
  }

  function handleClose() {
    if (!sessionId || offline) return;
    void backendTools.delete_widget(sessionId, { widget_id: widget.id, suppress_similar: false });
  }

  function handleReset() {
    for (const b of widget.bindings) setParam(b.param_key, b.default);
  }

  function handleRefineSubmit(instruction: string) {
    if (!sessionId || offline) return;
    setRefinePending(true);
    void backendTools
      .refine_widget(sessionId, { widget_id: widget.id, instruction, edits: [], additions: [] })
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
      style={{
        transform: `scale(${zoomInverse})`,
        transformOrigin: 'top left',
        ...(isExpanded
          ? { minWidth: `${WIDGET_SHELL_MIN_WIDTH}px` }
          : { width: `${WIDGET_COLLAPSED_WIDTH}px` }),
      }}
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
      />
      {isExpanded && (
        <>
          {/* Inline reasoning banner removed — the footer's "Why?" button
              already exposes the same string in a popover. */}
          {widget.op_id === 'time-of-day' && (
            <div className="px-1.5 py-1">
              <TimeOfDayWidgetBody widget={widget} />
            </div>
          )}
          {widget.bindings.length > 0 && isHslWidget(widget) && (
            <div className="px-1.5 py-1">
              <HslWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {widget.bindings.length > 0 && isFullLevelsWidget(widget) && (
            <div className="px-1.5 py-1">
              <LevelsWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {widget.bindings.length > 0 && widget.op_id !== 'time-of-day' && !isHslWidget(widget) && !isFullLevelsWidget(widget) && (
            <div className="flex flex-col gap-1.5 px-1.5 py-1">
              {widget.bindings.map((b) => {
                const eff = effectiveValue(b);
                const node = widget.nodes.find((n) => n.id === b.target.node_id);
                const isTouched = node?.layer_id
                  ? touched.has(touchKey(node.layer_id, node.type, b.target.param_key))
                  : false;
                // Engine neutral feeds the provenance check so an AI
                // slider reads VIOLET while still resting at the AI's
                // resolved value (= binding.default, ≠ engine 0). User
                // touch flips it to ACCENT (blue).
                const neutral = engineNeutralForBinding(b);
                return (
                  <BindingRow
                    key={b.param_key}
                    binding={b}
                    effectiveValue={eff}
                    maskSummaries={masks}
                    onChange={(value) => setParam(b.param_key, value)}
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
          <WidgetShellFooter
            onRefine={() => setRefineOpen((v) => !v)}
            onWhy={() => setWhyOpen((v) => !v)}
            onReset={handleReset}
            onApply={handleApply}
            applyDisabled={offline}
            showAiAffordances={showAiAffordances}
            whyButton={
              <WhyPopover open={whyOpen} widget={widget} onOpenChange={setWhyOpen}>
                <button className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]">
                  <HelpCircle size={10} aria-hidden /> Why?
                </button>
              </WhyPopover>
            }
          />
        </>
      )}
    </div>
  );
}
