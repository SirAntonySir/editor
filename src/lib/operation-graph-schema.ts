import { z } from 'zod';
import type { OperationGraph } from '@/types/operation-graph';
import type { Scope } from '@/types/scope';

// Pydantic serialises `Optional[X]` as `null` rather than omitting the field,
// so the schema accepts both `null` and missing on every optional, then
// normalises nulls to `undefined` so the downstream TS types stay clean.

// Legacy coercion: backend may still emit `kind: 'mask:click'` — rewrite to
// `mask:proposed` before passing to the discriminated union parser.
function coerceLegacyScope(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    (raw as Record<string, unknown>)['kind'] === 'mask:click'
  ) {
    const s = raw as Record<string, unknown>;
    return {
      kind: 'mask:proposed',
      label: 'detected',
      representativePoint: Array.isArray(s['point']) ? s['point'] : [0, 0],
      confidence: typeof s['confidence'] === 'number' ? s['confidence'] : undefined,
    };
  }
  return raw;
}

const ScopeSchema = z
  .unknown()
  .transform(coerceLegacyScope)
  .pipe(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('global') }),
      z.object({ kind: z.literal('mask'), maskRef: z.string() }),
      z.object({
        kind: z.literal('mask:proposed'),
        label: z.string(),
        representativePoint: z.tuple([z.number(), z.number()]),
        confidence: z.number().optional(),
      }),
    ]),
  ) as z.ZodType<Scope>;

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  scope: ScopeSchema,
  params: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
  inputs: z.array(z.string()).default([]),
});

const PanelBindingSchema = z
  .object({
    node_id: z.string(),
    param_key: z.string(),
    label: z.string(),
    control: z.enum(['slider', 'toggle', 'picker']).default('slider'),
    min: z.number().nullish(),
    max: z.number().nullish(),
    default: z.union([z.number(), z.string(), z.boolean()]).nullish(),
    step: z.number().nullish(),
    reasoning: z.string().nullish(),
  })
  .transform((b) => ({
    nodeId: b.node_id,
    paramKey: b.param_key,
    label: b.label,
    control: b.control,
    min: b.min ?? undefined,
    max: b.max ?? undefined,
    default: b.default ?? undefined,
    step: b.step ?? undefined,
    reasoning: b.reasoning ?? undefined,
  }));

export const OperationGraphSchema = z
  .object({
    id: z.string(),
    user_goal: z.string(),
    reasoning: z.string().nullish(),
    nodes: z.array(NodeSchema),
    panel_bindings: z.array(PanelBindingSchema),
    metadata: z.record(z.string()).default({}),
  })
  .transform<OperationGraph>((g) => ({
    id: g.id,
    userGoal: g.user_goal,
    reasoning: g.reasoning ?? undefined,
    nodes: g.nodes,
    panelBindings: g.panel_bindings,
    metadata: g.metadata,
  }));
