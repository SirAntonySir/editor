import { describe, it, expect } from 'vitest';
import type { Widget, WidgetNode } from '@/types/widget';
import { widgetTargetLayerIds } from './widget-targets';

/** Minimal Widget carrying just the nodes the helper reads. */
const widgetWith = (nodes: Partial<WidgetNode>[]): Widget =>
  ({ nodes } as unknown as Widget);

describe('widgetTargetLayerIds', () => {
  it('returns the singular layerId when a node has no replicate set', () => {
    const w = widgetWith([{ layerId: 'L-ctx' }]);
    expect(widgetTargetLayerIds(w)).toEqual(['L-ctx']);
  });

  it('reads the plural layerIds a connect/retarget wrote, not the frozen layerId', () => {
    // The "connected widget stays muted" case: layerId is the stale spawn-time
    // value ("legacy"); the layer the user tethered lives only in layerIds.
    const w = widgetWith([{ layerId: 'legacy', layerIds: ['legacy', 'L-new'] }]);
    expect(widgetTargetLayerIds(w)).toContain('L-new');
  });

  it('contributes nothing for a node-scope node with neither field', () => {
    const w = widgetWith([{ type: 'lut' }]);
    expect(widgetTargetLayerIds(w)).toEqual([]);
  });

  it('dedupes layers shared across nodes', () => {
    const w = widgetWith([{ layerId: 'L1' }, { layerIds: ['L1', 'L2'] }]);
    expect(widgetTargetLayerIds(w)).toEqual(['L1', 'L2']);
  });
});
