import { describe, it, expect } from 'vitest';
import { nodeToAdjustment } from './node-to-adjustment';
import type { Node } from '@/types/operation-graph';

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
});
