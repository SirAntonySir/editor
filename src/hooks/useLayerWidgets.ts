import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

/**
 * Returns the widgets whose operation_graph nodes target the given layer.
 * Reads directly from the backend snapshot — no client-side materialization.
 * Excludes dismissed widgets.
 */
export function useLayerWidgets(layerId: string | null): Widget[] {
  const widgets = useBackendState((s) => s.snapshot?.widgets);
  const nodes = useBackendState((s) => s.snapshot?.operationGraph.nodes);
  if (!layerId || !widgets || !nodes) return [];
  const widgetIdsOnLayer = new Set(
    nodes.filter((n) => n.layer_id === layerId).map((n) => n.widget_id),
  );
  return widgets.filter((w) => widgetIdsOnLayer.has(w.id) && w.status !== 'dismissed');
}
