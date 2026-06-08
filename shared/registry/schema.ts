import { z } from 'zod';

export const ParamTypeSchema = z.enum([
  'scalar', 'curve_points', 'color_hsv', 'enum', 'bool',
]);

export const ControlTypeSchema = z.enum([
  'slider', 'swatch', 'hue_wheel', 'curve_editor', 'point_list',
  'enum_select', 'bool_toggle', 'kelvin_strip',
]);

export const PresetSourceSchema = z.enum(['builtin', 'user', 'project']);

export const OpParamSchema = z.object({
  type: ParamTypeSchema,
  default: z.unknown(),
  range: z.tuple([z.number(), z.number()]).optional(),
  unit: z.string().optional(),
  /** Slider step size. Defaults to 1 when absent. */
  step: z.number().optional(),
  values: z.array(z.string()).optional(),
  min_points: z.number().int().optional(),
  max_points: z.number().int().optional(),
}).strict().superRefine((p, ctx) => {
  if (p.type === 'scalar' && !p.range) {
    ctx.addIssue({ code: 'custom', message: 'scalar params require range' });
  }
  if (p.type === 'enum' && (!p.values || p.values.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'enum params require values' });
  }
  if (p.type === 'curve_points') {
    const pts = p.default;
    if (!Array.isArray(pts) || pts.length < 2 ||
        pts.some(pt => !Array.isArray(pt) || pt.length !== 2)) {
      ctx.addIssue({ code: 'custom', message: 'curve_points default must be a list of at least 2 [x,y] pairs' });
    }
  }
});

export const OpBindingSchema = z.object({
  param_key: z.string(),
  control_type: ControlTypeSchema,
  label: z.string(),
  group: z.string().optional(),
}).strict();

export const OpLlmMetadataSchema = z.object({
  description: z.string(),
  typical_use: z.string(),
  semantic_tags: z.array(z.string()).default([]),
}).strict();

export const OpEngineConfigSchema = z.object({
  shader: z.string(),
  render_order: z.number().int(),
  node_type: z.string(),
}).strict();

export const RegistryOpSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  category: z.string().optional(),     // NEW — planner grouping hint
  llm: OpLlmMetadataSchema,
  params: z.record(z.string(), OpParamSchema),
  bindings: z.array(OpBindingSchema),
  engine: OpEngineConfigSchema,
  /**
   * Curated subset of param keys shown by the default toolrail widget.
   * Defaults to all binding param_keys when absent.
   */
  tool_defaults: z.array(z.string()).optional(),
}).strict().superRefine((op, ctx) => {
  for (const b of op.bindings) {
    if (!(b.param_key in op.params)) {
      ctx.addIssue({
        code: 'custom',
        message: `binding param_key "${b.param_key}" not in params`,
      });
    }
  }
});

export const PresetOpSchema = z.object({
  op_id: z.string(),
  params: z.record(z.string(), z.unknown()),
});

export const RegistryPresetSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  source: PresetSourceSchema.default('builtin'),
  description: z.string(),
  typical_use: z.string(),
  semantic_tags: z.array(z.string()).default([]),
  ops: z.array(PresetOpSchema),
}).strict();

export type RegistryOp = z.infer<typeof RegistryOpSchema>;
export type RegistryPreset = z.infer<typeof RegistryPresetSchema>;
export type OpParam = z.infer<typeof OpParamSchema>;
export type OpBinding = z.infer<typeof OpBindingSchema>;
