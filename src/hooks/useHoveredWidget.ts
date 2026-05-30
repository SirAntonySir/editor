import { useEditorStore } from '@/store';

export function useHoveredWidget() {
  const hoveredWidgetId = useEditorStore((s) => s.hoveredWidgetId);
  const setHoveredWidget = useEditorStore((s) => s.setHoveredWidget);
  return { hoveredWidgetId, setHoveredWidget };
}
