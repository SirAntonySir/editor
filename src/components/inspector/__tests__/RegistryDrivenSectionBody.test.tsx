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
    origin: { kind: 'mcp_user_prompt', prompt: 'test', parentWidgetId: null },
    opId: 'color',
    composed: false,
    nodes: [
      { id: 'n_a', type: 'basic', params: { saturation: 0 }, scope: { kind: 'global' }, inputs: [], widgetId: 'w_test' },
      { id: 'n_b', type: 'splitTone', params: { shadow_hue: 0 }, scope: { kind: 'global' }, inputs: [], widgetId: 'w_test' },
    ] as unknown as Widget['nodes'],
    bindings: [
      {
        paramKey: 'saturation', label: 'Saturation', controlType: 'slider',
        target: { nodeId: 'n_a', paramKey: 'saturation' },
        value: 0, default: 0,
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
      },
      {
        paramKey: 'shadow_hue', label: 'Hue', controlType: 'hue_wheel',
        target: { nodeId: 'n_b', paramKey: 'shadow_hue' },
        value: 0, default: 0,
        controlSchema: { controlType: 'hue_wheel', min: 0, max: 360 },
      },
    ] as unknown as Widget['bindings'],
    preview: { kind: 'none', autoBeforeAfter: false },
    rejectedAttempts: [],
    status: 'active',
    revision: 1,
    lockedParams: [],
    displayName: 'Warm fade',
    category: 'color',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeSingleOpWidget(): Widget {
  return {
    ...makeMultiOpWidget(),
    opId: 'grain',
    nodes: [
      { id: 'n_a', type: 'grain', params: { amount: 0, size: 100, roughness: 50 }, scope: { kind: 'global' }, inputs: [], widgetId: 'w_test' },
    ] as unknown as Widget['nodes'],
    bindings: [
      {
        paramKey: 'amount', label: 'Amount', controlType: 'slider',
        target: { nodeId: 'n_a', paramKey: 'amount' },
        value: 0, default: 0,
        controlSchema: { controlType: 'slider', min: 0, max: 100, step: 1 },
      },
    ] as unknown as Widget['bindings'],
    displayName: 'Film grain',
  };
}

beforeEach(() => {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    optimistic: new Map(),
    snapshot: {
      sessionId: 's1',
      imageContext: null,
      widgets: [],
      masksIndex: [],
      operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
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

  it('identifies ops by opId even when two ops share a node_type', () => {
    // light and color both have node_type "basic".
    const widget = makeMultiOpWidget();
    widget.nodes = [
      { id: 'n_a', type: 'basic', opId: 'light', params: { exposure: 0 }, scope: { kind: 'global' }, inputs: [], widgetId: 'w_test' },
      { id: 'n_b', type: 'basic', opId: 'color', params: { saturation: 0 }, scope: { kind: 'global' }, inputs: [], widgetId: 'w_test' },
    ] as unknown as Widget['nodes'];
    // Add minimal bindings so the panel renders something.
    widget.bindings = [
      {
        paramKey: 'exposure', label: 'Exposure', controlType: 'slider',
        target: { nodeId: 'n_a', paramKey: 'exposure' },
        value: 0, default: 0,
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
      },
      {
        paramKey: 'saturation', label: 'Saturation', controlType: 'slider',
        target: { nodeId: 'n_b', paramKey: 'saturation' },
        value: 0, default: 0,
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
      },
    ] as unknown as Widget['bindings'];

    const { getByText } = render(
      <RegistryDrivenSectionBody widget={widget} disabled={false} />,
    );
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Color')).toBeTruthy();
  });
});
