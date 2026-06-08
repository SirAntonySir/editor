import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RegistryDrivenSectionBody } from '../adjustments/RegistryDrivenSectionBody';
import { useBackendState } from '@/store/backend-state-slice';
import { registerAllProcessing } from '@/processing';
import type { Widget } from '@/types/widget';

// Register processing defs so the registry is populated before any test runs.
registerAllProcessing();

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn().mockResolvedValue({ ok: true }),
    set_param: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

function makeMultiOpWidget(): Widget {
  return {
    id: 'w_test',
    intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 'test', parent_widget_id: null },
    op_id: 'color',
    composed: false,
    nodes: [
      { id: 'n_a', type: 'basic', params: { saturation: 0 }, scope: { kind: 'global' }, inputs: [], widget_id: 'w_test' },
      { id: 'n_b', type: 'splitTone', params: { shadow_hue: 0 }, scope: { kind: 'global' }, inputs: [], widget_id: 'w_test' },
    ] as unknown as Widget['nodes'],
    bindings: [
      {
        param_key: 'saturation', label: 'Saturation', control_type: 'slider',
        target: { node_id: 'n_a', param_key: 'saturation' },
        value: 0, default: 0,
        control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
      },
      {
        param_key: 'shadow_hue', label: 'Hue', control_type: 'hue_wheel',
        target: { node_id: 'n_b', param_key: 'shadow_hue' },
        value: 0, default: 0,
        control_schema: { control_type: 'hue_wheel', min: 0, max: 360 },
      },
    ] as unknown as Widget['bindings'],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    locked_params: [],
    display_name: 'Warm fade',
    category: 'color',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeSingleOpWidget(): Widget {
  return {
    ...makeMultiOpWidget(),
    op_id: 'grain',
    nodes: [
      { id: 'n_a', type: 'grain', params: { amount: 0, size: 100, roughness: 50 }, scope: { kind: 'global' }, inputs: [], widget_id: 'w_test' },
    ] as unknown as Widget['nodes'],
    bindings: [
      {
        param_key: 'amount', label: 'Amount', control_type: 'slider',
        target: { node_id: 'n_a', param_key: 'amount' },
        value: 0, default: 0,
        control_schema: { control_type: 'slider', min: 0, max: 100, step: 1 },
      },
    ] as unknown as Widget['bindings'],
    display_name: 'Film grain',
  };
}

beforeEach(() => {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    optimistic: new Map(),
    snapshot: {
      session_id: 's1',
      image_context: null,
      widgets: [],
      masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
      revision: 1,
    },
  } as never);
});

afterEach(() => cleanup());

describe('RegistryDrivenSectionBody multi-op rendering', () => {
  it('renders one section header per op when widget has multiple nodes', () => {
    const widget = makeMultiOpWidget();
    // color op (node_type: 'basic') is loaded before light in the registry glob
    // (alphabetical: color.json < light.json), so 'basic' maps to 'Color'.
    const { getByText } = render(
      <RegistryDrivenSectionBody widget={widget} disabled={false} />,
    );
    expect(getByText('Color')).toBeTruthy();
    expect(getByText('Split Tone')).toBeTruthy();
  });

  it('renders flat (no section header) for single-op widgets', () => {
    const widget = makeSingleOpWidget();
    const { queryByText } = render(
      <RegistryDrivenSectionBody widget={widget} disabled={false} />,
    );
    // Single-op path must NOT render a section header.
    expect(queryByText('Grain')).toBeFalsy();
  });

  it('identifies ops by op_id even when two ops share a node_type', () => {
    // light and color both have node_type "basic".
    const widget = makeMultiOpWidget();
    widget.nodes = [
      { id: 'n_a', type: 'basic', op_id: 'light', params: { exposure: 0 }, scope: { kind: 'global' }, inputs: [], widget_id: 'w_test' },
      { id: 'n_b', type: 'basic', op_id: 'color', params: { saturation: 0 }, scope: { kind: 'global' }, inputs: [], widget_id: 'w_test' },
    ] as unknown as Widget['nodes'];
    // Add minimal bindings so the panel renders something.
    widget.bindings = [
      {
        param_key: 'exposure', label: 'Exposure', control_type: 'slider',
        target: { node_id: 'n_a', param_key: 'exposure' },
        value: 0, default: 0,
        control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
      },
      {
        param_key: 'saturation', label: 'Saturation', control_type: 'slider',
        target: { node_id: 'n_b', param_key: 'saturation' },
        value: 0, default: 0,
        control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
      },
    ] as unknown as Widget['bindings'];

    const { getByText } = render(
      <RegistryDrivenSectionBody widget={widget} disabled={false} />,
    );
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Color')).toBeTruthy();
  });
});
