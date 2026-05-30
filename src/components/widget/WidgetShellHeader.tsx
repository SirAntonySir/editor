import { Sparkles } from 'lucide-react';
import type { Widget } from '@/types/widget';

interface WidgetShellHeaderProps {
  widget: Widget;
  expanded: boolean;
  dirty: boolean;
  onToggle: () => void;
  onClose: () => void;
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
  return '—';
}

function scopeDotClass(widget: Widget): string {
  return widget.scope.kind === 'global' ? 'bg-text-secondary' : 'bg-orange-500';
}

export function WidgetShellHeader({ widget, expanded, dirty, onToggle, onClose }: WidgetShellHeaderProps) {
  const ai = isAiVariant(widget);
  return (
    <div
      role="button"
      aria-label="Toggle widget"
      onClick={onToggle}
      className="flex items-center gap-1.5 px-1.5 py-1 cursor-pointer select-none"
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
        <span
          aria-label="AI-composed widget"
          className="inline-flex items-center gap-0.5 text-[8px] font-semibold tracking-wide bg-accent text-white px-1 rounded-[3px] leading-none py-px"
        >
          <Sparkles size={8} aria-hidden />AI
        </span>
      ) : (
        <span
          aria-label="Tool-invoked widget"
          className="inline-flex items-center text-[8px] font-semibold bg-surface-secondary text-text-secondary px-1 rounded-[3px] leading-none py-px"
        >
          ·
        </span>
      )}
      <span className="text-[11px] font-medium flex-1 min-w-0 truncate text-text-primary">{widget.intent}</span>
      {dirty && (
        <span aria-label="Bindings edited" className="w-[5px] h-[5px] rounded-full bg-accent" />
      )}
      <span className="inline-flex items-center gap-1 text-[9px] text-text-secondary bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-px leading-[1.4]">
        <span className={`w-[5px] h-[5px] rounded-full ${scopeDotClass(widget)}`} />
        {scopeLabel(widget)}
      </span>
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
