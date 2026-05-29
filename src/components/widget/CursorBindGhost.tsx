import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { ToolRegistry } from '@/lib/tool-registry';
import type { Widget } from '@/types/widget';

const EMPTY_WIDGETS: Widget[] = [];

/**
 * Floating semi-transparent card that follows the cursor while a
 * cursor-bind is pending. Fixed positioning — independent of the Fabric
 * canvas transform.
 */
export function CursorBindGhost() {
  const pending = useEditorStore((s) => s.pendingBind);
  const cursor = useEditorStore((s) => s.cursor);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);

  if (!pending || !cursor) return null;

  let label = '';
  if (pending.kind === 'tool') {
    const tool = ToolRegistry.get(pending.toolName);
    const proc = tool?.processingId ? ProcessingRegistry.get(tool.processingId) : null;
    label = proc?.label ?? tool?.label ?? pending.toolName;
  } else {
    const w = widgets.find((w) => w.id === pending.widgetId);
    label = w?.intent ?? 'Suggestion';
  }

  return (
    <div
      className="fixed pointer-events-none z-[100] rounded-md bg-surface/90 border border-glass-border
        px-2.5 py-1.5 text-[10px] text-text-primary shadow-lg backdrop-blur-sm"
      style={{
        left: cursor.x + 12,
        top: cursor.y + 12,
        opacity: 0.7,
      }}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-text-secondary text-[9px]">click to drop · esc to cancel</span>
    </div>
  );
}
