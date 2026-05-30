import { useEffect, useRef, useState } from 'react';
import type { Widget, MaskSummary } from '@/types/widget';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useWidgetExpansion } from '@/hooks/useWidgetExpansion';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { WidgetShellHeader } from './WidgetShellHeader';
import { WidgetShellFooter } from './WidgetShellFooter';
import { PreviewSlot } from './PreviewSlot';
import { RefineInput } from './RefineInput';
import { WhyPopover } from './WhyPopover';
import { BindingRow } from '@/components/inspector/widget/BindingRow';

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

  const [whyOpen, setWhyOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePending, setRefinePending] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const hovered = hoveredWidgetId === widget.id;

  const widgetPatch = optimistic.get(widget.id);
  // dirty: any binding diverges from default (optimistic-aware)
  const dirty = widget.bindings.some((b) => {
    const patch = widgetPatch?.bindings.find((p) => p.paramKey === b.param_key);
    const effective = patch ? patch.value : b.value;
    return effective !== b.default;
  });

  function setParam(paramKey: string, value: Widget['bindings'][number]['value']) {
    if (!sessionId || offline) return;
    void backendTools.set_widget_param(sessionId, { widget_id: widget.id, param_key: paramKey, value });
  }

  function handleApply() {
    if (!sessionId) return;
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
    const patch = widgetPatch?.bindings.find((p) => p.paramKey === b.param_key);
    return patch ? patch.value : b.value;
  }

  return (
    <div
      className={`overlay w-[226px] ${hovered ? 'border-accent' : ''}`}
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
              <span className="line-clamp-2">{widget.reasoning}</span>
            </div>
          )}
          <PreviewSlot kind={widget.preview.kind} />
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
          />
          <WhyPopover open={whyOpen} widget={widget} onOpenChange={setWhyOpen} />
        </>
      )}
    </div>
  );
}
