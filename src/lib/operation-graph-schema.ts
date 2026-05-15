import { z } from 'zod';
import type { OperationGraph } from '@/types/operation-graph';

// Pydantic serialises `Optional[X]` as `null` rather than omitting the field,
// so the schema accepts both `null` and missing on every optional, then
// normalises nulls to `undefined` so the downstream TS types stay clean.
const ScopeSchema = z
  .object({
    kind: z.enum(['global', 'mask:click', 'mask:proposed']),
    label: z.string().nullish(),
    point: z.tuple([z.number(), z.number()]).nullish(),
    confidence: z.number().min(0).max(1).nullish(),
  })
  .transform((s) => ({
    kind: s.kind,
    label: s.label ?? undefined,
    point: s.point ?? undefined,
    confidence: s.confidence ?? undefined,
  }));

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
