import { describe, it, expect } from 'vitest';
import { sliceWidgetByOp } from './widget-slices';
import type { Widget } from '@/types/widget';

function fakeWidget(): Widget {
  return {
    id: 'w_1', intent: 'test', scope: { root: { kind: 'global' } },
    origin: { kind: 'mcp_user_prompt' },
    composed: false, status: 'active', revision: 1, lockedParams: [],
    preview: { kind: 'none', autoBeforeAfter: false },
    nodes: [
      { id: 'n_a', type: 'basic', opId: 'light', params: { exposure: -80 },
        scope: { root: { kind: 'global' } }, inputs: [], widgetId: 'w_1', layerId: 'layer-1' },
    ],
    bindings: [
      { paramKey: 'exposure', label: 'Exposure', controlType: 'slider',
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
        value: -80, default: 0, target: { nodeId: 'n_a', paramKey: 'exposure' } },
    ],
  } as unknown as Widget;
}

describe('sliceWidgetByOp', () => {
  it('produces one slice per node with its bindings and values', () => {
    const slices = sliceWidgetByOp(fakeWidget());
    expect(slices).toHaveLength(1);
    expect(slices[0].nodeId).toBe('n_a');
    expect(slices[0].op.id).toBe('light');
    expect(slices[0].values.exposure).toBe(-80);
  });
});
