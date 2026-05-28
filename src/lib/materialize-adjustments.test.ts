import { describe, it, expect } from 'vitest';
import { materializeAdjustments } from './materialize-adjustments';
import type { Widget, WidgetNode, ControlBinding } from '@/types/widget';

const baseWidget: Widget = {
  id: 'w_a', intent: 'Warm skin', scope: { kind: 'global' },
  origin: { kind: 'mcp_user_prompt', prompt: 'warmer' },
  composed: false, nodes: [], bindings: [],
  preview: { kind: 'thumbnail', auto_before_after: true },
  rejected_attempts: [], status: 'active', revision: 1,
  created_at: '2026-05-28T00:00:00Z', updated_at: '2026-05-28T00:00:00Z',
};

describe('materializeAdjustments', () => {
  it('maps each node to an Adjustment with aiSource set', () => {
    const node: WidgetNode = {
      id: 'n1', type: 'kelvin', params: { temperature: 6800 },
      scope: { kind: 'global' }, inputs: [], widget_id: 'w_a',
    };
    const binding: ControlBinding = {
      param_key: 'temperature', label: 'Temperature', control_type: 'slider',
      target: { node_id: 'n1', param_key: 'temperature' },
      control_schema: { control_type: 'slider', min: 3000, max: 9000, step: 50 },
      value: 7100, default: 6500,
    };
    const adjs = materializeAdjustments({ ...baseWidget, nodes: [node], bindings: [binding] });
    expect(adjs).toHaveLength(1);
    expect(adjs[0].type).toBe('kelvin');
    expect(adjs[0].params).toEqual({ temperature: 7100 });
    expect(adjs[0].aiSource?.widgetId).toBe('w_a');
    expect(adjs[0].aiSource?.intent).toBe('Warm skin');
  });

  it('falls back to node param when no binding overrides', () => {
    const node: WidgetNode = {
      id: 'n1', type: 'basic', params: { exposure: 0.5 },
      scope: { kind: 'global' }, inputs: [], widget_id: 'w_a',
    };
    const adjs = materializeAdjustments({ ...baseWidget, nodes: [node], bindings: [] });
    expect(adjs[0].params).toEqual({ exposure: 0.5 });
  });

  it('returns empty array when widget has no nodes', () => {
    const adjs = materializeAdjustments({ ...baseWidget, nodes: [], bindings: [] });
    expect(adjs).toEqual([]);
  });
});
