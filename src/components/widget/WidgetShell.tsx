import { useEffect, useRef, useState } from 'react';
import type { Widget, MaskSummary } from '@/types/widget';
import { HelpCircle } from 'lucide-react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useWidgetExpansion } from '@/hooks/useWidgetExpansion';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { WidgetShellHeader } from './WidgetShellHeader';
import { WidgetShellFooter } from './WidgetShellFooter';
import { RefineInput } from './RefineInput';
import { WhyPopover } from './WhyPopover';
import { BindingRow } from '@/components/inspector/widget/BindingRow';

/**
 * Minimum WidgetShell width in CSS pixels. The shell grows past this to fit
 * its content. Tailwind's `min-w-[226px]` is a compile-time literal, so keep
 * the literal in the className in sync with this constant.
 */
export const WIDGET_SHELL_MIN_WIDTH = 226;

interface WidgetShellProps {
  widget: Widget;
}

const EMPTY_MASKS: MaskSummary[] = [];

export function WidgetShell({ widget }: WidgetShellProps) {
  const { isExpanded, toggle } = useWidgetExpansion(widget.id);
  const { hoveredWidgetId, setHoveredWidget } = useHoveredWidget();
  const sessionId = useBackendState((s) => s.sessionId);
  const optimistic = useBackendState((s) => s.optimistic);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  const showAiAffordances = widget.origin.kind !== 'tool_invoked';

  const [whyOpen, setWhyOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePending, setRefinePending] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const hovered = hoveredWidgetId === widget.id;

  // Optimistic patches are keyed by the operation_graph node id the binding
  // targets — that matches the renderer's view of params and lets a slider
  // move pixels before the backend SSE roundtrip completes.
  function readOptimistic(b: Widget['bindings'][number]): Widget['bindings'][number]['value'] | undefined {
    const patch = optimistic.get(b.target.node_id);
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
      useBackendState.getState().applyOptimistic(binding.target.node_id, {
        bindings: [{ paramKey: binding.target.param_key, value }],
        baseRevision,
      });
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
      // min-w-[226px] matches WIDGET_SHELL_MIN_WIDTH; width grows to fit content.
      className={`overlay min-w-[226px] w-fit ${hovered ? 'border-accent' : ''}`}
      onMouseEnter={() => setHoveredWidget(widget.id)}
      onMouseLeave={() => setHoveredWidget(null)}
    >
      <WidgetShellHeader
        widget={widget}
        expanded={isExpanded}
        dirty={dirty}
        onToggle={toggle}
        onClose={handleClose}
      />
      {isExpanded && (
        <>
          {widget.reasoning && (
            <div className="flex items-start gap-1.5 px-1.5 py-1 border-b border-separator bg-surface-secondary text-[10px] text-text-secondary leading-snug">
              <span className="flex-none mt-0.5">ⓘ</span>
              <span className="line-clamp-2 max-w-[200px]">{widget.reasoning}</span>
            </div>
          )}
          {widget.bindings.length > 0 && (
            <div className="flex flex-col gap-1.5 px-1.5 py-1">
              {widget.bindings.map((b) => (
                <BindingRow
                  key={b.param_key}
                  binding={b}
                  effectiveValue={effectiveValue(b)}
                  maskSummaries={masks}
                  onChange={(value) => setParam(b.param_key, value)}
                />
              ))}
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
