import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, X, HelpCircle, ArrowUpRight, Sparkles } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';
import { BindingRow } from '@/components/inspector/widget/BindingRow';
import { WhyPopover } from '@/components/widget/WhyPopover';
import { bindingProvenance, touchKey } from '@/hooks/useParamProvenance';
import type { ControlBinding, ControlValue, MaskSummary, Scope, Widget } from '@/types/widget';

// Stable empty reference so the masks selector doesn't return a fresh literal
// each render (avoids useSyncExternalStore re-render churn when snapshot is null).
const EMPTY_MASKS: MaskSummary[] = [];

/** Human-readable chip label for a widget's scope. Defensive: the projected
 * scope shape can drift, so we read `kind`/`label` off an unknown narrowing. */
function scopeChipLabel(scope: Scope): string {
  const s = scope as { kind?: string; label?: string };
  switch (s.kind) {
    case 'global':
      return 'global';
    case 'named_region':
      return s.label ?? 'region';
    case 'mask:proposed':
      return s.label ?? 'region';
    case 'mask':
      return 'mask';
    case 'image_node':
      return 'layer';
    default:
      return 'global';
  }
}

interface AiSectionProps {
  widget: Widget;
}

/**
 * An AI suggestion rendered as an editable accordion section. It is a VIEW of
 * the SAME widget the canvas shell shows, so it reads the widget's own bindings
 * (optimistic-aware) and writes via `set_widget_param` — identical to
 * `WidgetShell` — keeping the two views perfectly in sync. (Tool sections, by
 * contrast, are the canonical view of the active layer.)
 */
export function AiSection({ widget }: AiSectionProps) {
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(widget.id));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const optimistic = useBackendState((s) => s.optimistic);
  const maskSummaries = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const touched = useEditorStore((s) => s.touchedParams);
  const onCanvas = useEditorStore((s) => Boolean(s.widgetNodes[widget.id]));
  const [showWhy, setShowWhy] = useState(false);

  function canWrite(): boolean {
    return Boolean(sessionId) && !offline;
  }

  function canonIdFor(b: ControlBinding): string | null {
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    if (!node) return null;
    return `canon:${node.layer_id}:${node.type}`;
  }

  // Effective value = pending optimistic patch (keyed by the canonical node id)
  // falling back to the widget's stored binding value. Mirrors WidgetShell.
  function effectiveOf(b: ControlBinding): ControlValue {
    const canonId = canonIdFor(b);
    const patch = canonId ? optimistic.get(canonId) : undefined;
    const opt = patch?.bindings.find((p) => p.paramKey === b.target.param_key)?.value;
    return opt !== undefined ? opt : b.value;
  }

  function setParam(b: ControlBinding, value: ControlValue) {
    if (!canWrite() || !sessionId) return;
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    const canonId = node ? `canon:${node.layer_id}:${node.type}` : b.target.node_id;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    useBackendState.getState().applyOptimistic(canonId, {
      bindings: [{ paramKey: b.target.param_key, value }],
      baseRevision,
    });
    if (node?.layer_id) {
      useEditorStore.getState().markParamTouched(touchKey(node.layer_id, node.type, b.target.param_key));
    }
    void backendTools.set_widget_param(sessionId, { widget_id: widget.id, param_key: b.param_key, value });
  }

  function onApply() {
    if (!canWrite() || !sessionId) return;
    void backendTools.accept_widget(sessionId, { widget_id: widget.id });
  }

  function onClose() {
    if (!canWrite() || !sessionId) return;
    void backendTools.delete_widget(sessionId, { widget_id: widget.id, suppress_similar: false });
  }

  function onReset() {
    for (const b of widget.bindings) setParam(b, b.default);
  }

  function provenanceOf(b: ControlBinding, eff: ControlValue): ReturnType<typeof bindingProvenance> {
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    const isTouched = node?.layer_id
      ? touched.has(touchKey(node.layer_id, node.type, b.target.param_key))
      : false;
    return bindingProvenance(eff, b.default, true, isTouched);
  }

  // Group bindings by the node (operation) they target so the user can see
  // which ops the AI composed. Order preserves first-appearance of each node
  // in the original bindings list. Bindings whose target_node_id has no
  // matching widget node fall into a synthetic "_" bucket and render without
  // a header (defensive — shouldn't happen in practice).
  const opGroups = useMemo(() => {
    const order: string[] = [];
    const byNode = new Map<string, ControlBinding[]>();
    for (const b of widget.bindings) {
      const nid = b.target.node_id;
      if (!byNode.has(nid)) {
        byNode.set(nid, []);
        order.push(nid);
      }
      byNode.get(nid)!.push(b);
    }
    return order.map((nid) => {
      const node = widget.nodes.find((n) => n.id === nid);
      return {
        nodeId: nid,
        nodeType: node?.type ?? '',
        label: node ? ProcessingRegistry.getAdjustmentName(node.type) : '',
        bindings: byNode.get(nid)!,
      };
    });
  }, [widget.bindings, widget.nodes]);

  // TODO(accordion): wire Refine — deferred, see plan Task 7
  return (
    <div className="border-b border-separator">
      <div className="w-full flex items-center gap-2 px-2.5 py-2">
        <Sparkles
          size={13}
          className="shrink-0 text-ai"
          aria-label="AI suggestion"
        />
        <span className="sr-only">AI suggestion</span>
        <span className="flex-1 truncate text-xs font-medium text-text-primary">{widget.intent}</span>
        <span className="text-[10px] text-text-secondary">{scopeChipLabel(widget.scope)}</span>
        <button
          type="button"
          disabled={offline || onCanvas}
          onClick={() => tetherWorkspaceWidgetOnEngage(widget)}
          aria-label={onCanvas ? 'Already on canvas' : 'Open on canvas'}
          title={onCanvas ? 'Already on canvas' : 'Open on canvas'}
          className="inline-flex items-center text-text-secondary hover:text-text-primary hover:bg-surface-secondary p-0.5 rounded-[3px] disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ArrowUpRight size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => toggle(widget.id)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="text-text-secondary hover:text-text-primary"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-text-secondary hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 px-2.5 pb-2">
          {opGroups.map((grp) => (
            <div key={grp.nodeId} className="flex flex-col gap-1.5">
              {grp.label && (
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className="text-[9px] uppercase tracking-wide text-text-secondary">
                    {grp.label}
                  </span>
                  <span className="flex-1 h-px bg-separator" aria-hidden />
                </div>
              )}
              {grp.bindings.map((b) => {
                const eff = effectiveOf(b);
                return (
                  <BindingRow
                    key={b.target.node_id + ':' + b.target.param_key}
                    binding={b}
                    effectiveValue={eff}
                    onChange={(v) => setParam(b, v)}
                    maskSummaries={maskSummaries}
                    provenance={provenanceOf(b, eff)}
                  />
                );
              })}
            </div>
          ))}
          <div className="flex items-center gap-px pt-1 border-t border-separator">
            <WhyPopover open={showWhy} widget={widget} onOpenChange={setShowWhy}>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
              >
                <HelpCircle size={10} aria-hidden /> Why?
              </button>
            </WhyPopover>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onReset}
              className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={offline}
              className="text-[10px] bg-ai text-white border border-ai rounded-[4px] px-2 py-0.5 hover:bg-ai/90 disabled:opacity-50 disabled:cursor-not-allowed ml-1"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
