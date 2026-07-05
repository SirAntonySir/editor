import { describe, it, expect } from 'vitest';
import {
  parseLayerHandle, imageNodeForLayer, isValidTetherConnection,
} from './workspace-connect';
import type { ImageNodeState, TetherEdgeState } from '@/types/workspace';

const imageNodes: Record<string, ImageNodeState> = {
  img_a: { id: 'img_a', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 },
    size: { w: 10, h: 10 }, sourceSize: { w: 10, h: 10 } },
  img_b: { id: 'img_b', layerIds: ['L3'], position: { x: 0, y: 0 },
    size: { w: 10, h: 10 }, sourceSize: { w: 10, h: 10 } },
};

describe('parseLayerHandle', () => {
  it('extracts the layer id from a rail handle', () => {
    expect(parseLayerHandle('layer-tether-L1')).toBe('L1');
    expect(parseLayerHandle('layer-tether-abc-123')).toBe('abc-123');
  });
  it('returns null for non-rail handles', () => {
    expect(parseLayerHandle('tether-in-left')).toBeNull();
    expect(parseLayerHandle(null)).toBeNull();
    expect(parseLayerHandle(undefined)).toBeNull();
  });
});

describe('imageNodeForLayer', () => {
  it('resolves the owning node', () => {
    expect(imageNodeForLayer(imageNodes, 'L2')).toBe('img_a');
    expect(imageNodeForLayer(imageNodes, 'L3')).toBe('img_b');
  });
  it('returns null when no node owns the layer', () => {
    expect(imageNodeForLayer(imageNodes, 'GONE')).toBeNull();
  });
});

describe('isValidTetherConnection', () => {
  const ctx = { widgetIds: new Set(['w1']), tetherEdges: {} as Record<string, TetherEdgeState> };

  it('accepts widget → layer handle', () => {
    expect(isValidTetherConnection(
      { source: 'w1', target: 'img_a', sourceHandle: 'tether-out-right', targetHandle: 'layer-tether-L1' },
      ctx,
    )).toBe(true);
  });
  it('rejects image → image', () => {
    expect(isValidTetherConnection(
      { source: 'img_b', target: 'img_a', sourceHandle: null, targetHandle: 'layer-tether-L1' },
      ctx,
    )).toBe(false);
  });
  it('rejects a target that is not a layer handle', () => {
    expect(isValidTetherConnection(
      { source: 'w1', target: 'img_a', sourceHandle: null, targetHandle: 'tether-in-left' },
      ctx,
    )).toBe(false);
  });
  it('rejects a duplicate (widget, layer) pair', () => {
    const dupCtx = {
      widgetIds: new Set(['w1']),
      tetherEdges: { 'te-w1-L1': { id: 'te-w1-L1' } as TetherEdgeState },
    };
    expect(isValidTetherConnection(
      { source: 'w1', target: 'img_a', sourceHandle: null, targetHandle: 'layer-tether-L1' },
      dupCtx,
    )).toBe(false);
  });
});
