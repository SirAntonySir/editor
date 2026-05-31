import { useState } from 'react';
import { ChevronRight, ChevronDown, X } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { BindingRow } from '@/components/inspector/widget/BindingRow';
import type { ControlBinding, ControlValue, MaskSummary, Scope, Widget } from '@/types/widget';

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

interface AiBindingRowProps {
  widget: Widget;
  binding: ControlBinding;
  maskSummaries: MaskSummary[];
}

/** One binding row that resolves its canonical (layer, op, param) slot and
 * drives it through useCanonicalParam. Module-scope so the hook is never
 * called in a loop (no-nested-component / rules-of-hooks safe). */
function AiBindingRow({ widget, binding, maskSummaries }: AiBindingRowProps) {
  const node = widget.nodes.find((n) => n.id === binding.target.node_id);
  return node?.layer_id
    ? (
      <ResolvedBindingRow
        layerId={node.layer_id}
        op={node.type}
        binding={binding}
        maskSummaries={maskSummaries}
      />
    )
    : <BindingRow binding={binding} effectiveValue={binding.value} onChange={() => {}} maskSummaries={maskSummaries} />;
}

interface ResolvedBindingRowProps {
  layerId: string;
  op: string;
  binding: ControlBinding;
  maskSummaries: MaskSummary[];
}

function ResolvedBindingRow({ layerId, op, binding, maskSummaries }: ResolvedBindingRowProps) {
  const [value, setValue] = useCanonicalParam<ControlValue>(
    layerId,
    op,
    binding.target.param_key,
    binding.default,
  );
  return (
    <BindingRow
      binding={binding}
      effectiveValue={value}
      onChange={setValue}
      maskSummaries={maskSummaries}
    />
  );
}

interface AiSectionProps {
  widget: Widget;
}

export function AiSection({ widget }: AiSectionProps) {
  const expanded = useEditorStore((s) => s.expandedSectionIds.has(widget.id));
  const toggle = useEditorStore((s) => s.toggleSectionExpanded);
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const maskSummaries = useBackendState((s) => s.snapshot?.masks_index ?? []);
  const [showWhy, setShowWhy] = useState(false);

  function canWrite(): boolean {
    return Boolean(sessionId) && !offline;
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
    if (!canWrite() || !sessionId) return;
    for (const b of widget.bindings) {
      const node = widget.nodes.find((n) => n.id === b.target.node_id);
      if (!node?.layer_id) continue;
      void backendTools.set_param(sessionId, {
        layer_id: node.layer_id,
        op: node.type,
        param: b.target.param_key,
        value: b.default,
      });
    }
  }

  // TODO(accordion): wire Refine — deferred, see plan Task 7
  return (
    <div className="border-b border-border">
      <div className="w-full flex items-center gap-2 px-2.5 py-2">
        <span className="w-4 h-4 shrink-0 rounded-sm bg-accent text-white flex items-center justify-center text-[7px] font-semibold">
          AI
        </span>
        <span className="flex-1 truncate text-xs font-medium text-text-primary">{widget.intent}</span>
        <span className="text-[10px] text-text-secondary">{scopeChipLabel(widget.scope)}</span>
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
          {showWhy && widget.reasoning && (
            <p className="text-[10px] leading-snug text-text-secondary">{widget.reasoning}</p>
          )}
          {widget.bindings.map((b) => (
            <AiBindingRow
              key={b.target.node_id + ':' + b.target.param_key}
              widget={widget}
              binding={b}
              maskSummaries={maskSummaries}
            />
          ))}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-0.5"
            >
              Why
            </button>
            <button
              type="button"
              onClick={onReset}
              className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-0.5"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onApply}
              className="text-[10px] text-white bg-accent rounded px-2 py-0.5"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
