import { describe, expect, it } from 'vitest';
import { RegistryOpSchema, RegistryPresetSchema, OpParamSchema } from '../../../../shared/registry/schema';

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

describe('RegistryOpSchema category', () => {
  it('accepts a category', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'x', display_name: 'X', category: 'color',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'a', control_type: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    });
    expect(parsed.category).toBe('color');
  });

  it('treats category as optional', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'a', control_type: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    });
    expect(parsed.category).toBeUndefined();
  });
});

describe('RegistryOpSchema compound block', () => {
  const baseOp = {
    id: 'x', display_name: 'X', category: 'tone',
    llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
    params: {
      position: { type: 'scalar', range: [0, 1], default: 0.3 },
      k: { type: 'scalar', range: [0, 100], default: 50 },
    },
    bindings: [
      { param_key: 'position', control_type: 'slider', label: 'T' },
      { param_key: 'k', control_type: 'slider', label: 'K' },
    ],
    engine: { shader: 'compound', render_order: 5, node_type: 'compound' },
  };

  it('accepts a valid compound block', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'position', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.driver).toBe('position');
  });

  it('rejects unsorted anchors', () => {
    expect(() => RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'position', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.5, name: 'b', values: { k: 90 } },
          { position: 0.0, name: 'a', values: { k: 10 } },
        ],
      },
    })).toThrow();
  });

  it('rejects driver not in params', () => {
    expect(() => RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'bogus', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    })).toThrow();
  });

  it('treats compound as optional', () => {
    const parsed = RegistryOpSchema.parse(baseOp);
    expect(parsed.compound).toBeUndefined();
  });
});

describe('OpCompoundConfigSchema topology', () => {
  const baseOp = {
    id: 'x', display_name: 'X', category: 'mood',
    llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
    params: {
      p: { type: 'scalar', range: [0, 1], default: 0.5 },
      k: { type: 'scalar', range: [0, 100], default: 50 },
    },
    bindings: [
      { param_key: 'p', control_type: 'slider', label: 'P' },
      { param_key: 'k', control_type: 'slider', label: 'K' },
    ],
    engine: { shader: 'compound', render_order: 5, node_type: 'compound' },
  };

  it('defaults topology to linear', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.topology).toBe('linear');
  });

  it('accepts wheel topology', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d', topology: 'wheel',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.topology).toBe('wheel');
  });

  it('rejects unknown topology', () => {
    expect(() => RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d', topology: 'radial-grid',
        anchors: [
          { position: 0.0, name: 'a', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    })).toThrow();
  });

  it('accepts optional color on CompoundAnchor', () => {
    const parsed = RegistryOpSchema.parse({
      ...baseOp,
      compound: {
        driver: 'p', interpolation: 'catmull_rom_1d',
        anchors: [
          { position: 0.0, name: 'a', color: '#22c55e', values: { k: 10 } },
          { position: 1.0, name: 'b', values: { k: 90 } },
        ],
      },
    });
    expect(parsed.compound?.anchors[0].color).toBe('#22c55e');
    expect(parsed.compound?.anchors[1].color).toBeUndefined();
  });
});

describe('strict mode parity', () => {
  it('rejects extra keys on RegistryOpSchema', () => {
    expect(() => RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'a', control_type: 'slider', label: 'A' }],
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
