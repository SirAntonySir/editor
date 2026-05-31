import { describe, it, expect } from 'vitest';
import { nodeToAdjustment } from './node-to-adjustment';
import type { Node } from '@/types/operation-graph';
import { IDENTITY_CURVES } from '@/types/widget';

describe('nodeToAdjustment', () => {
  it('maps numeric params verbatim', () => {
    const node = {
      id: 'n1', type: 'kelvin', scope: { kind: 'global' },
      params: { temperature: 6500 }, inputs: [],
    } as unknown as Node;
    const adj = nodeToAdjustment(node);
    expect(adj.id).toBe('n1');
    expect(adj.type).toBe('kelvin');
    expect(adj.params).toEqual({ temperature: 6500 });
    expect(adj.enabled).toBe(true);
  });

  it('drops non-number params (string/boolean)', () => {
    const node = {
      id: 'n2', type: 'choice', scope: { kind: 'global' },
      params: { temperature: 6500, mode: 'auto', enabled: true },
      inputs: [],
    } as unknown as Node;
    const adj = nodeToAdjustment(node);
    expect(adj.params).toEqual({ temperature: 6500 });
  });

  it('inherits scope from node', () => {
    const node = {
      id: 'n3', type: 'basic', scope: { kind: 'mask', mask_id: 'm_1' },
      params: { exposure: 0.5 }, inputs: [],
    } as unknown as Node;
    const adj = nodeToAdjustment(node);
    expect(adj.scope).toEqual({ kind: 'mask', mask_id: 'm_1' });
  });

  it('evaluates a curves node into four Float32Array channel LUTs', () => {
    const node = {
      id: 'n_c', type: 'curves',
      params: { curves: {
        ...IDENTITY_CURVES,
        rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
      } },
      scope: { kind: 'global' },
    } as unknown as Parameters<typeof nodeToAdjustment>[0];

    const adj = nodeToAdjustment(node);
    expect(adj.type).toBe('curves');
    for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
      expect(adj.params[ch]).toBeInstanceOf(Float32Array);
      expect((adj.params[ch] as Float32Array).length).toBe(256);
    }
    const rgb = adj.params.rgb as Float32Array;
    expect(rgb[128]).toBeGreaterThan(0.5); // midpoint lifted above identity
  });
});
