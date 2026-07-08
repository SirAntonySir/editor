import type { Widget } from '@/types/widget';

/**
 * The layers a widget actually acts on: the union of every node's replicate set
 * (`layerIds ?? [layerId]`), deduped in first-seen order.
 *
 * Connect / retarget mutate the plural `layerIds`; the singular `layerId` is
 * frozen at spawn (the `"legacy"` sentinel for a context-less widget, or the
 * original context layer). So any code asking "which layers does this widget
 * target?" MUST read the plural set — reading `layerId` alone misses layers the
 * user tethered after spawn, which is what left connected widgets stuck dimmed
 * ("muted") and unrecognised by their image node.
 *
 * Node-scope nodes carrying neither field contribute nothing.
 */
export function widgetTargetLayerIds(widget: Widget): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of widget.nodes) {
    const ids = n.layerIds ?? (n.layerId ? [n.layerId] : []);
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}
