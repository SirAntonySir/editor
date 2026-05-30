import { useEditorStore } from '@/store';

export function useDragOverride(widgetId: string) {
  const override = useEditorStore((s) => s.sessionDragOverrides.get(widgetId));
  const setDragOverride = useEditorStore((s) => s.setDragOverride);
  const clearDragOverride = useEditorStore((s) => s.clearDragOverride);
  return {
    override,
    set: (pos: { x: number; y: number }) => setDragOverride(widgetId, pos),
    clear: () => clearDragOverride(widgetId),
  };
}
