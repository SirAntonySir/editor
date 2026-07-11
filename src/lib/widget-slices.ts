import { loadRegistry } from '@/lib/registry/loader';
import type { Widget, ControlBinding } from '@/types/widget';
import type { RegistryOp } from '../../shared/registry/schema';

export interface OpSlice {
  op: RegistryOp;
  bindings: ControlBinding[];
  values: Record<string, unknown>;
  nodeId: string;
}

export function sliceWidgetByOp(widget: Widget): OpSlice[] {
  const reg = loadRegistry();
  const slices: OpSlice[] = [];
  for (const node of widget.nodes) {
    let op = node.opId ? reg.ops[node.opId] : undefined;
    if (!op) {
      // Back-compat: nodes without opId (e.g. persisted before this feature) — match by node_type.
      op = Object.values(reg.ops).find((o) => o.engine.node_type === node.type);
    }
    if (!op) {
      console.warn(`RegistryDrivenSectionBody: no registry op for node ${node.id} (type=${node.type}, opId=${node.opId ?? 'none'})`);
      continue;
    }
    const bindings = widget.bindings.filter((b) => b.target?.nodeId === node.id);
    const values: Record<string, unknown> = {};
    for (const b of bindings) values[b.paramKey] = b.value;
    slices.push({ op, bindings, values, nodeId: node.id });
  }
  return slices;
}
