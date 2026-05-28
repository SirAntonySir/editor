import { nodeToAdjustment } from './node-to-adjustment';
import type { Adjustment, AiSource } from '@/types/adjustment';
import type { Widget } from '@/types/widget';
import type { Node } from '@/types/operation-graph';

/**
 * Convert an accepted Widget's nodes + current binding values into a list of
 * Adjustments ready for appending to a layer's adjustmentStack. The binding
 * values override the node's default params (binding.value > node.params).
 * Each Adjustment carries an aiSource pointing back to the widget.
 */
export function materializeAdjustments(widget: Widget): Adjustment[] {
  const aiSource: AiSource = {
    widgetId: widget.id,
    intent: widget.intent,
    reasoning: widget.reasoning,
    acceptedAt: new Date().toISOString(),
  };
  return widget.nodes.map((wnode) => {
    // Apply binding overrides for this node's params
    const params: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(wnode.params)) {
      params[k] = v;
    }
    for (const b of widget.bindings) {
      if (b.target.node_id === wnode.id) {
        params[b.target.param_key] = b.value;
      }
    }
    // Build a node-shaped object for nodeToAdjustment (which drops non-number params).
    const nodeShape = {
      id: wnode.id,
      type: wnode.type,
      scope: wnode.scope,
      params,
      inputs: wnode.inputs,
    } as unknown as Node;
    const adj = nodeToAdjustment(nodeShape);
    return { ...adj, aiSource };
  });
}
