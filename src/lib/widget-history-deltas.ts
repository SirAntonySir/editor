/** A single param that moved between two history boundaries. `from`/`to` are
 *  `undefined` when the param was added/removed at that boundary. */
export interface ParamDelta {
  param: string;
  from: unknown;
  to: unknown;
}

type NodeParams = Record<string, Record<string, unknown>>;

/**
 * Diff two per-node param maps (`{ nodeId → { param → value } }`) into a flat
 * list of changed params. Used by a history node's rows to render
 * `Exposure 0.5 → 0.3`. Params are flattened across nodes (a widget's params
 * are unique by key in practice); unchanged params are omitted.
 */
export function computeParamDeltas(before: NodeParams, after: NodeParams): ParamDelta[] {
  const deltas: ParamDelta[] = [];
  const nodeIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const nodeId of nodeIds) {
    const b = before[nodeId] ?? {};
    const a = after[nodeId] ?? {};
    const paramKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const param of paramKeys) {
      const from = b[param];
      const to = a[param];
      if (!Object.is(from, to)) {
        deltas.push({ param, from, to });
      }
    }
  }
  return deltas;
}
