import { type ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Check, Copy, Eye, EyeOff, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { Widget } from '@/types/widget';

interface WidgetContextMenuProps {
  widget: Widget;
  children: ReactNode;
}

// Shared with the image-node menu look: dense flat rows, 10px text, 11px icons.
const itemClass =
  'px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none text-text-primary ' +
  'hover:bg-surface-secondary focus:bg-surface-secondary flex items-center gap-1.5';
const itemClassDim =
  'px-2 py-1 text-[10px] rounded-sm cursor-not-allowed outline-none text-text-secondary ' +
  'opacity-60 flex items-center gap-1.5';
const itemClassDanger =
  'px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none flex items-center gap-1.5 ' +
  'text-[var(--color-danger,#e5484d)] ' +
  'hover:bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_12%,transparent)]';

/**
 * Right-click menu for a widget node. Mirrors the image-node ContextMenu
 * (same Radix primitives, same flat icon-row look) so a widget's menu reads as
 * part of the same family rather than the generic canvas Undo/Redo menu it used
 * to fall through to. Actions reuse the existing widget surface: `accept_widget`
 * (Apply), `repeat_widget` (Duplicate), `delete_widget` (Delete), plus the
 * expand/hide store toggles the header buttons already drive.
 */
export function WidgetContextMenu({ widget, children }: WidgetContextMenuProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const expanded = useEditorStore((s) => s.expandedWidgetIds.has(widget.id));
  const hidden = useEditorStore((s) => s.hiddenWidgetIds.has(widget.id));
  const toggleExpanded = useEditorStore((s) => s.toggleWidgetExpanded);
  const toggleHidden = useEditorStore((s) => s.toggleWidgetHidden);

  const apply = () => {
    if (!sessionId || offline) return;
    void backendTools.accept_widget(sessionId, { widgetId: widget.id });
  };
  const duplicate = () => {
    if (!sessionId || offline) return;
    void backendTools.repeat_widget(sessionId, { widgetId: widget.id });
  };
  const remove = () => {
    if (!sessionId || offline) return;
    void backendTools.delete_widget(sessionId, { widgetId: widget.id, suppressSimilar: false });
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="overlay p-1 min-w-[160px] z-50">
          <ContextMenu.Item
            className={itemClass}
            onSelect={() => toggleExpanded(widget.id)}
          >
            {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            <span>{expanded ? 'Collapse' : 'Expand'}</span>
          </ContextMenu.Item>

          {/* Genfill widgets resolve through Accept/Discard on their own body,
              not the Apply-as-promotion path — hide Apply for them. */}
          {!widget.genfill && (
            <ContextMenu.Item
              className={offline ? itemClassDim : itemClass}
              disabled={offline}
              onSelect={apply}
            >
              <Check size={11} />
              <span>Apply</span>
            </ContextMenu.Item>
          )}

          <ContextMenu.Item
            className={offline ? itemClassDim : itemClass}
            disabled={offline}
            onSelect={duplicate}
          >
            <Copy size={11} />
            <span>Duplicate</span>
          </ContextMenu.Item>

          <ContextMenu.Item
            className={itemClass}
            onSelect={() => toggleHidden(widget.id)}
          >
            {hidden ? <Eye size={11} /> : <EyeOff size={11} />}
            <span>{hidden ? 'Show' : 'Hide'}</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-separator my-1" />

          <ContextMenu.Item
            className={offline ? itemClassDim : itemClassDanger}
            disabled={offline}
            onSelect={remove}
          >
            <Trash2 size={11} />
            <span>Delete</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
