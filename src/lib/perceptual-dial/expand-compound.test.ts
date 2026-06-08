import { describe, it, expect, beforeEach } from 'vitest';
import { expandCompoundNodes } from './expand-compound';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { registerAllProcessing } from '@/processing';
import type { Node } from '@/types/operation-graph';

beforeEach(() => {
  // Ensure all processing definitions are present so adjustmentType lookup works.
  if (!ProcessingRegistry.has('light')) registerAllProcessing();
});

function compoundNode(params: Record<string, number>): Node {
  return {
    id: 'c1',
    type: 'compound',
    layer_id: 'L1',
    params,
    inputs: [],
    scope: { kind: 'global' },
  };
}

describe('expandCompoundNodes', () => {
  it('passes non-compound nodes through unchanged', () => {
    const nodes: Node[] = [{
      id: 'n1', type: 'basic', layer_id: 'L1', inputs: [],
      params: { exposure: 0.2 }, scope: { kind: 'global' },
    }];
    expect(expandCompoundNodes(nodes)).toEqual(nodes);
  });

  it('expands a compound node into one virtual node per adjustmentType', () => {
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'kelvin.kelvin': 3400,
      'hsl.orange_sat': 25,
    })]);
    expect(out).toHaveLength(3);
    const types = out.map((n) => n.type);
    expect(types).toContain('basic');
    expect(types).toContain('kelvin');
    expect(types).toContain('hsl');
    const basic = out.find((n) => n.type === 'basic')!;
    expect(basic.params).toEqual({ exposure: 0.2 });
    expect(basic.layer_id).toBe('L1');
    expect(basic.scope).toEqual({ kind: 'global' });
  });

  it('merges ops that share an adjustmentType into one virtual node', () => {
    // light + color both map to adjustmentType 'basic'.
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'color.vibrance': 12,
    })]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('basic');
    expect(out[0].params).toEqual({ exposure: 0.2, vibrance: 12 });
  });

  it('emits virtual nodes in DEFAULT_COMPOUND_ORDER', () => {
    const out = expandCompoundNodes([compoundNode({
      'hsl.orange_sat': 25,
      'kelvin.kelvin': 3400,
      'light.exposure': 0.2,
    })]);
    const types = out.map((n) => n.type);
    // basic comes before hsl which comes before kelvin per the default order.
    expect(types.indexOf('basic')).toBeLessThan(types.indexOf('hsl'));
    expect(types.indexOf('hsl')).toBeLessThan(types.indexOf('kelvin'));
  });

  it('assigns synthesised ids that namespace on the compound id', () => {
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'kelvin.kelvin': 3400,
    })]);
    const ids = out.map((n) => n.id).sort();
    expect(ids).toEqual(['c1::basic', 'c1::kelvin']);
  });

  it('drops compound keys whose op is not registered (graceful skip)', () => {
    const out = expandCompoundNodes([compoundNode({
      'light.exposure': 0.2,
      'noSuchOp.foo': 1,
    })]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('basic');
  });

  it('honours per-compound compoundOrder when set on the ProcessingDefinition', () => {
    // We register a fake definition with a non-default order to verify the hook.
    ProcessingRegistry.register({
      id: 'test-compound',
      label: 'Test Compound',
      icon: () => null as never,
      category: 'adjust',
      adjustmentType: 'compound',
      params: [],
      Panel: () => null as never,
      compoundOrder: ['kelvin', 'basic'],
    });
    const node: Node = compoundNode({ 'light.exposure': 0.2, 'kelvin.kelvin': 3400 });
    // Mark the compound to use the test definition by setting compound_def_id.
    (node as Node & { compound_def_id?: string }).compound_def_id = 'test-compound';
    const out = expandCompoundNodes([node]);
    const types = out.map((n) => n.type);
    expect(types).toEqual(['kelvin', 'basic']);
  });
});
