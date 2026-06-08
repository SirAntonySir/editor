import { describe, expect, it } from 'vitest';
import { RegistryOpSchema, RegistryPresetSchema } from '../../../../shared/registry/schema';

describe('RegistryOpSchema', () => {
  it('accepts a minimal op', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'grain',
      display_name: 'Grain',
      llm: { description: 'd', typical_use: 'u', semantic_tags: ['t'] },
      params: { amount: { type: 'scalar', range: [0, 100], default: 0 } },
      bindings: [{ param_key: 'amount', control_type: 'slider', label: 'Amount' }],
      engine: { shader: 'grain', render_order: 50, node_type: 'grain' },
    });
    expect(parsed.id).toBe('grain');
  });

  it('rejects unknown control_type', () => {
    expect(() => RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'a', control_type: 'made_up', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    })).toThrow();
  });

  it('rejects binding for unknown param', () => {
    expect(() => RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'b', control_type: 'slider', label: 'B' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    })).toThrow();
  });
});

describe('RegistryPresetSchema', () => {
  it('accepts a minimal preset', () => {
    const p = RegistryPresetSchema.parse({
      id: 'vintage', display_name: 'Vintage', source: 'builtin',
      description: 'd', typical_use: 'u', semantic_tags: [],
      ops: [{ op_id: 'grain', params: { amount: 15 } }],
    });
    expect(p.ops[0].op_id).toBe('grain');
  });
});
