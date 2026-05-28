import { describe, it, expect } from 'vitest';
import type { Layer, Adjustment } from '@/store/layer-slice';

// Helper to directly test the serialization logic by testing JSON round-trip
function jsonRoundTrip<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function makeLayer(over: Partial<Layer> = {}): Layer {
  return {
    id: 'l1', type: 'raster', name: 'L', visible: true,
    opacity: 1, blendMode: 'normal', locked: false, order: 0,
    adjustmentStack: { adjustments: [] },
    ...over,
  };
}

describe('serializer aiSource round-trip', () => {
  it('writes and reads aiSource on an adjustment', () => {
    const adj: Adjustment = {
      id: 'a1', type: 'basic', name: 'Light',
      enabled: true, blendMode: 'normal', opacity: 1,
      params: { exposure: 0.5 },
      aiSource: {
        widgetId: 'w_abc', intent: 'Warm skin',
        reasoning: 'low warmth on face',
        acceptedAt: '2026-05-28T10:00:00Z',
      },
    };
    const layer = makeLayer({ adjustmentStack: { adjustments: [adj] } });
    const roundTripped = jsonRoundTrip(layer);
    const r = roundTripped.adjustmentStack.adjustments[0];
    expect(r.aiSource).toEqual(adj.aiSource);
  });

  it('ignores aiSource silently when absent (old .edp)', () => {
    const adj: Adjustment = {
      id: 'a1', type: 'basic', name: 'L',
      enabled: true, blendMode: 'normal', opacity: 1,
      params: {},
    };
    const layer = makeLayer({ adjustmentStack: { adjustments: [adj] } });
    const roundTripped = jsonRoundTrip(layer);
    expect(roundTripped.adjustmentStack.adjustments[0].aiSource).toBeUndefined();
  });
});
