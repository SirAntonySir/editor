import { useEditorStore } from '@/store';

export function useWidgetExpansion(widgetId: string) {
  const isExpanded = useEditorStore((s) => s.expandedWidgetIds.has(widgetId));
  const toggleWidgetExpanded = useEditorStore((s) => s.toggleWidgetExpanded);
  return {
    isExpanded,
    toggle: () => toggleWidgetExpanded(widgetId),
  };
}
