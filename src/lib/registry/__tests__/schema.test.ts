import { describe, expect, it } from 'vitest';
import { RegistryOpSchema, RegistryPresetSchema, OpParamSchema } from '../../../../shared/registry/schema';

describe('RegistryOpSchema', () => {
  it('accepts a minimal op', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'grain',
      display_name: 'Grain',
      llm: { description: 'd', typical_use: 'u', semantic_tags: ['t'] },
      params: { amount: { type: 'scalar', range: [0, 100], default: 0 } },
      bindings: [{ paramKey: 'amount', controlType: 'slider', label: 'Amount' }],
      engine: { shader: 'grain', render_order: 50, node_type: 'grain' },
    });
    expect(parsed.id).toBe('grain');
  });

  it('rejects unknown control_type', () => {
    expect(() => RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ paramKey: 'a', controlType: 'made_up', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    })).toThrow();
  });

  it('rejects binding for unknown param', () => {
    expect(() => RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ paramKey: 'b', controlType: 'slider', label: 'B' }],
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

describe('RegistryOpSchema category', () => {
  it('accepts a category', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'x', display_name: 'X', category: 'color',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ paramKey: 'a', controlType: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    });
    expect(parsed.category).toBe('color');
  });

  it('treats category as optional', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ paramKey: 'a', controlType: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    });
    expect(parsed.category).toBeUndefined();
  });
});

describe('strict mode parity', () => {
  it('rejects extra keys on RegistryOpSchema', () => {
    expect(() => RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ paramKey: 'a', controlType: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
      whoops_extra: 'forbidden',
    })).toThrow();
  });

  it('rejects extra keys on OpParamSchema', () => {
    expect(() => OpParamSchema.parse({
      type: 'scalar', range: [0, 1], default: 0, extra_key: 'no',
    })).toThrow();
  });
});
