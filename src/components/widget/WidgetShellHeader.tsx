import { type ReactNode } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import type { Widget } from '@/types/widget';
import { loadRegistry } from '@/lib/registry/loader';
import { Tooltip } from '@/components/ui/Tooltip';
import { useEditorStore } from '@/store';
import { imageNodeLabel } from '@/lib/command-palette';

/** Plain "?" glyph sized to match the lucide icon row. Used instead of
 *  `HelpCircle` so the affordance has no outline — fits the flat register. */
function QuestionGlyph() {
  return (
    <span
      aria-hidden
      className="inline-block leading-none font-semibold text-[12px] -mt-px"
    >
      ?
    </span>
  );
}

function resolveTitle(widget: Widget): string {
  if (widget.displayName) return widget.displayName;
  const reg = loadRegistry();
  const op = widget.opId ? reg.ops[widget.opId] : undefined;
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
  /** Refine the widget via the AI backend. Only rendered when
   *  `showAiAffordances` is true. */
  onRefine: () => void;
  /** Show the Why? popover. The default render is the bare button; pass
   *  `whyButton` to wrap it (e.g. inside a Radix Popover trigger). */
  onWhy: () => void;
  /** Snap all bindings back to their default values. Always available. */
  onReset: () => void;
  /** Accept the widget — backend records acceptance and the widget transitions
   *  to its `accepted` lifecycle state. Always available. */
  onApply: () => void;
  /** True when the backend is offline or accept is otherwise unavailable. */
  applyDisabled: boolean;
  /** Distinguishes AI-composed widgets (show Refine + Why; Apply tinted violet)
   *  from tool-invoked widgets (no AI affordances; Apply tinted accent). */
  showAiAffordances: boolean;
  /** Optional override for the Why? button — used to wrap it inside a
   *  Popover.Trigger asChild element. The supplied node MUST be a single
   *  button-shaped element. */
  whyButton?: ReactNode;
}

function isAiVariant(widget: Widget): boolean {
  const k = widget.origin.kind;
  return k === 'mcp_user_prompt' || k === 'mcp_autonomous' || k === 'refine' || k === 'repeat';
}

function staticScopeLabel(widget: Widget): string | null {
  const s = widget.scope;
  // Only surface a scope chip for scopes that aren't the default 'global' —
  // 90 % of widgets sit at global and the chip just adds noise.
  if (s.kind === 'global') return null;
  if (s.kind === 'named_region') return s.label;
  if (s.kind === 'mask:proposed') return s.label;
  if (s.kind === 'mask') return s.mask_id ? s.mask_id.slice(0, 6) : null;
  // image_node is handled by `useScopeLabel` so the chip mirrors any rename.
  return null;
}

/** Resolve the scope chip text. For image_node scopes, prefer the user-set
 *  override on the workspace node, then fall back to the first layer's name
 *  (matches the Cmd+K target chip via `imageNodeLabel`). */
function useScopeLabel(widget: Widget): string | null {
  const imageNode = useEditorStore((s) =>
    widget.scope.kind === 'image_node'
      ? s.imageNodes[widget.scope.imageNodeId]
      : undefined,
  );
  const layers = useEditorStore((s) => s.layers);
  if (widget.scope.kind === 'image_node') {
    if (!imageNode) return `Image (${widget.scope.layerIds.length})`;
    return imageNodeLabel(imageNode, layers);
  }
  return staticScopeLabel(widget);
}

/** Shared classes for the ghost icon buttons (Refine, Why, Reset, Eye, X).
 *  size-4 (16×16) keeps the hover background tight around the 11-px icon —
 *  size-5 leaves a ring of empty fill on hover that reads as chunky padding. */
const GHOST_BTN =
  'inline-flex items-center justify-center size-4 rounded-[3px] ' +
  'text-text-secondary hover:text-text-primary hover:bg-surface-secondary ' +
  'transition-colors';

/**
 * Slim header: AI badge (only for AI widgets) · title · scope chip (only
 * when non-global) · expanded-only action row (Refine, Why, Reset, Apply) ·
 * eye · close (×, only when expanded).
 *
 * The original WidgetShellFooter has been folded into this header so the
 * widget shell renders without a footer — leaving only the ImageNode's
 * ObjectModeFooter as the canvas's bottom-of-card chrome. Action buttons
 * appear only when expanded (same as the X close button) since they have no
 * meaning on a collapsed pill.
 */
export function WidgetShellHeader({
  widget,
  expanded,
  dirty,
  hidden,
  onToggle,
  onClose,
  onToggleHidden,
  onRefine,
  onWhy,
  onReset,
  onApply,
  applyDisabled,
  showAiAffordances,
  whyButton,
}: WidgetShellHeaderProps) {
  // `dirty` is kept in the prop interface as a hook for future affordances;
  // the legacy edit-state dot has been removed in favour of slider-level
  // provenance colour.
  void dirty;
  const ai = isAiVariant(widget);
  const scope = useScopeLabel(widget);

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
      className="workspace-drag-handle flex items-center gap-1 px-1.5 py-1 cursor-grab active:cursor-grabbing select-none"
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

      {/* Action buttons — only rendered when expanded, matching the X close
          button's existing pattern. Each stops propagation so the row's
          onClick (toggle) doesn't fire underneath. Order: Refine · Why ·
          Reset · Eye · Apply ✓ · Close ✗ — Apply and Close are placed
          adjacent at the trailing edge so the accept/reject pair reads as
          a single decision unit. */}
      {expanded && showAiAffordances && (
        <>
          <Tooltip label="Refine — ask the AI to reshape this widget">
            <button
              type="button"
              aria-label="Refine widget"
              onClick={(e) => { e.stopPropagation(); onRefine(); }}
              className={GHOST_BTN}
            >
              <Pencil size={11} aria-hidden />
            </button>
          </Tooltip>
          {whyButton ?? (
            <Tooltip label="Why this widget?">
              <button
                type="button"
                aria-label="Explain widget"
                onClick={(e) => { e.stopPropagation(); onWhy(); }}
                className={GHOST_BTN}
              >
                <QuestionGlyph />
              </button>
            </Tooltip>
          )}
        </>
      )}
      {expanded && (
        <Tooltip label="Reset to defaults">
          <button
            type="button"
            aria-label="Reset widget"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            className={GHOST_BTN}
          >
            <RotateCcw size={11} aria-hidden />
          </button>
        </Tooltip>
      )}

      <Tooltip label={hidden ? 'Show on canvas' : 'Hide from canvas'}>
        <button
          type="button"
          aria-label={hidden ? 'Show widget' : 'Hide widget'}
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          className={GHOST_BTN}
        >
          {hidden ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}
        </button>
      </Tooltip>

      {expanded && (
        <>
          {/* Accept (✓) / Reject (✗) pair. Both are flat ghost icon buttons —
              the previous filled-circle Apply read as a heavy stamp; matching
              the row's visual weight is more in line with the flat register.
              Apply's tint (AI violet for AI widgets, accent for tool) is the
              only visual signal that it's the primary action. */}
          <Tooltip label="Apply this widget">
            <button
              type="button"
              aria-label="Apply widget"
              disabled={applyDisabled}
              onClick={(e) => { e.stopPropagation(); onApply(); }}
              className={[
                'inline-flex items-center justify-center size-4 rounded-[3px]',
                'transition-colors',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                showAiAffordances
                  ? 'text-ai hover:bg-[color-mix(in_srgb,var(--color-ai)_14%,transparent)]'
                  : 'text-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]',
              ].join(' ')}
            >
              <Check size={12} strokeWidth={2.5} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label="Discard widget">
            <button
              type="button"
              aria-label="Close widget"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className={GHOST_BTN}
            >
              <X size={11} aria-hidden />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
