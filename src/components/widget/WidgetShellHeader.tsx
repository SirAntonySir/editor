import { Eye, EyeOff, Sparkles } from 'lucide-react';
import type { Widget } from '@/types/widget';
import { loadRegistry } from '@/lib/registry/loader';

function resolveTitle(widget: Widget): string {
  if (widget.display_name) return widget.display_name;
  const reg = loadRegistry();
  const op = widget.op_id ? reg.ops[widget.op_id] : undefined;
  if (op) return op.display_name;
  return widget.intent;
}

interface WidgetShellHeaderProps {
  widget: Widget;
  expanded: boolean;
  dirty: boolean;
  hidden: boolean;
  onToggle: () => void;
  onClose: () => void;
  onToggleHidden: () => void;
}

function isAiVariant(widget: Widget): boolean {
  const k = widget.origin.kind;
  return k === 'mcp_user_prompt' || k === 'mcp_autonomous' || k === 'refine' || k === 'repeat';
}

function scopeLabel(widget: Widget): string {
  const s = widget.scope;
  if (s.kind === 'global') return 'Global';
  if (s.kind === 'named_region') return s.label;
  if (s.kind === 'mask:proposed') return s.label;
  if (s.kind === 'mask') return s.mask_id.slice(0, 6);
  if (s.kind === 'image_node') return `Image (${s.layer_ids.length} layer${s.layer_ids.length === 1 ? '' : 's'})`;
  return '—';
}

function scopeDotClass(widget: Widget): string {
  return widget.scope.kind === 'global' ? 'bg-text-secondary' : 'bg-orange-500';
}

export function WidgetShellHeader({
  widget,
  expanded,
  dirty,
  hidden,
  onToggle,
  onClose,
  onToggleHidden,
}: WidgetShellHeaderProps) {
  // `dirty` is kept in the prop interface as a hook for future affordances;
  // the legacy edit-state dot has been removed in favour of slider-level
  // provenance colour.
  void dirty;
  const ai = isAiVariant(widget);
  return (
    <div
      role="button"
      aria-label="Toggle widget"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className="workspace-drag-handle flex items-center gap-1.5 px-1.5 py-1 cursor-grab active:cursor-grabbing select-none"
    >
      <span className="grip flex flex-col gap-px pr-1 opacity-55" aria-hidden>
        {[0,1,2].map((r) => (
          <span key={r} className="flex gap-px">
            <i className="w-[2px] h-[2px] rounded-full bg-text-secondary" />
            <i className="w-[2px] h-[2px] rounded-full bg-text-secondary" />
          </span>
        ))}
      </span>
      {ai ? (
        <Sparkles
          size={12}
          className="shrink-0 text-ai"
          aria-label="AI-composed widget"
        />
      ) : (
        <span
          aria-label="Tool-invoked widget"
          className="inline-flex items-center text-[8px] font-semibold bg-surface-secondary text-text-secondary px-1 rounded-[3px] leading-none py-px"
        >
          ·
        </span>
      )}
      <span className="text-[11px] font-medium flex-1 min-w-0 truncate text-text-primary">{resolveTitle(widget)}</span>
      <span className="inline-flex items-center gap-1 text-[9px] text-text-secondary bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-px leading-[1.4]">
        <span className={`w-[5px] h-[5px] rounded-full ${scopeDotClass(widget)}`} />
        {scopeLabel(widget)}
      </span>
      <button
        type="button"
        aria-label={hidden ? 'Show widget' : 'Hide widget'}
        onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
        className="inline-flex items-center justify-center text-text-secondary hover:text-text-primary px-0.5"
      >
        {hidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
      </button>
      <span className="text-text-secondary text-[11px] leading-none px-0.5" aria-hidden>{expanded ? '⌄' : '›'}</span>
      {expanded && (
        <button
          aria-label="Close widget"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="text-text-secondary hover:text-text-primary text-[13px] leading-none px-0.5"
        >
          ×
        </button>
      )}
    </div>
  );
}
