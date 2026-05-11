import { z } from 'zod';
import type { OperationGraph } from '@/types/operation-graph';

const ScopeSchema = z.object({
  kind: z.enum(['global', 'mask:click', 'mask:proposed']),
  label: z.string().optional(),
  point: z.tuple([z.number(), z.number()]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

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
    min: z.number().optional(),
    max: z.number().optional(),
    default: z.union([z.number(), z.string(), z.boolean()]).optional(),
    step: z.number().optional(),
    reasoning: z.string().optional(),
  })
  .transform((b) => ({
    nodeId: b.node_id,
    paramKey: b.param_key,
    label: b.label,
    control: b.control,
    min: b.min,
    max: b.max,
    default: b.default,
    step: b.step,
    reasoning: b.reasoning,
  }));

export const OperationGraphSchema = z
  .object({
    id: z.string(),
    user_goal: z.string(),
    reasoning: z.string().optional(),
    nodes: z.array(NodeSchema),
    panel_bindings: z.array(PanelBindingSchema),
    metadata: z.record(z.string()).default({}),
  })
  .transform<OperationGraph>((g) => ({
    id: g.id,
    userGoal: g.user_goal,
    reasoning: g.reasoning,
    nodes: g.nodes,
    panelBindings: g.panel_bindings,
    metadata: g.metadata,
  }));
