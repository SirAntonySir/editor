import { Eye, EyeOff, Sparkles, X } from 'lucide-react';
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

function scopeLabel(widget: Widget): string | null {
  const s = widget.scope;
  // Only surface a scope chip for scopes that aren't the default 'global' —
  // 90 % of widgets sit at global and the chip just adds noise.
  if (s.kind === 'global') return null;
  if (s.kind === 'named_region') return s.label;
  if (s.kind === 'mask:proposed') return s.label;
  if (s.kind === 'mask') return s.mask_id.slice(0, 6);
  if (s.kind === 'image_node') return `Image (${s.layer_ids.length})`;
  return null;
}

/**
 * Slim header: AI badge (only for AI widgets) · title · scope chip (only
 * when non-global) · eye · close (×, only when expanded).
 *
 * The previous header showed a grip-dots column, a `·` tool placeholder,
 * a permanent "Global" scope chip, and a chevron — all of which doubled
 * affordances already conveyed elsewhere (the whole row is the drag handle,
 * the body's visibility communicates expand state, etc.). They've been
 * removed; the row stays draggable via the surrounding cursor-grab and
 * the body's expand state is the disclosure cue.
 */
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
  const scope = scopeLabel(widget);
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
      className="workspace-drag-handle flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing select-none"
    >
      {ai && (
        <Sparkles
          size={12}
          className="shrink-0 text-ai"
          aria-label="AI-composed widget"
        />
      )}
      <span className="text-[11px] font-medium flex-1 min-w-0 truncate text-text-primary widget-title-ellipsis">
        {resolveTitle(widget)}
      </span>
      {scope && (
        <span className="inline-flex items-center gap-1 text-[9px] text-text-secondary bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-px leading-[1.4]">
          <span className="w-[5px] h-[5px] rounded-full bg-orange-500" />
          {scope}
        </span>
      )}
      <button
        type="button"
        aria-label={hidden ? 'Show widget' : 'Hide widget'}
        onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
        className="inline-flex items-center justify-center text-text-secondary hover:text-text-primary px-0.5"
      >
        {hidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
      </button>
      {expanded && (
        <button
          type="button"
          aria-label="Close widget"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="inline-flex items-center justify-center text-text-secondary hover:text-text-primary px-0.5"
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </div>
  );
}
