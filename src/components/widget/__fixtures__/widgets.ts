import type { Widget } from '@/types/widget';

const baseTimestamp = '2026-05-30T10:00:00Z';

export function makeAiWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w-ai-1',
    intent: 'Warm up shadows',
    reasoning: 'Sky reads cool; gentle lift + warm shift restores depth.',
    scope: { kind: 'named_region', label: 'sky' },
    origin: { kind: 'mcp_autonomous', anchor: { kind: 'region_label', label: 'sky' } },
    composed: true,
    nodes: [],
    bindings: [
      {
        param_key: 'exposure', label: 'Exposure', control_type: 'slider',
        target: { node_id: 'n-1', param_key: 'exposure' },
        control_schema: { control_type: 'slider', min: -1, max: 1, step: 0.01 },
        value: 0.4, default: 0,
      },
    ],
    preview: { kind: 'histogram_delta', auto_before_after: false },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    locked_params: [],
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
    ...overrides,
  } as Widget;
}

export function makeToolWidget(overrides: Partial<Widget> = {}): Widget {
  return makeAiWidget({
    id: 'w-tool-1',
    intent: 'Light',
    reasoning: undefined,
    origin: { kind: 'tool_invoked' },
    op_id: 'light',
    scope: { kind: 'global' },
    preview: { kind: 'none', auto_before_after: false },
    ...overrides,
  });
}

const HSL_CHANNELS = ['hue', 'sat', 'lum'] as const;

/** An HSL widget over the given bands (all 3 channels each), node type 'hsl'.
 *  One band → single-band widget; eight → all-bands. */
export function makeHslWidget(bands: string[], overrides: Partial<Widget> = {}): Widget {
  const nodeId = 'n-hsl';
  const keys = bands.flatMap((b) => HSL_CHANNELS.map((c) => `${b}_${c}`));
  return makeAiWidget({
    id: 'w-hsl-1',
    intent: 'HSL',
    reasoning: undefined,
    origin: { kind: 'tool_invoked' },
    op_id: bands.length === 1 ? `hsl_${bands[0]}` : 'hsl',
    scope: { kind: 'global' },
    preview: { kind: 'none', auto_before_after: false },
    nodes: [{
      id: nodeId, type: 'hsl', scope: { kind: 'global' }, inputs: [], widget_id: 'w-hsl-1',
      layer_id: 'L1', params: Object.fromEntries(keys.map((k) => [k, 0])),
    }],
    bindings: keys.map((k) => ({
      param_key: k, label: k.replace('_', ' '), control_type: 'slider',
      target: { node_id: nodeId, param_key: k },
      control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
      value: 0, default: 0,
    })),
    ...overrides,
  });
}

export function makeGlobalWidget(overrides: Partial<Widget> = {}): Widget {
  return makeAiWidget({
    id: 'w-global-1',
    intent: 'Tighten midtone contrast',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', anchor: { kind: 'global' } },
    ...overrides,
  });
}

/** A compound Time-of-Day widget. Its sole binding is `time_of_day.position`. */
export function makeTimeOfDayWidget(overrides: Partial<Widget> = {}): Widget {
  const nodeId = 'c1';
  const widgetId = 'w-tod-1';
  return makeAiWidget({
    id: widgetId,
    intent: 'Time of Day',
    reasoning: undefined,
    origin: { kind: 'tool_invoked' },
    op_id: 'time-of-day',
    scope: { kind: 'global' },
    preview: { kind: 'none', auto_before_after: false },
    nodes: [{
      id: nodeId, type: 'compound', scope: { kind: 'global' }, inputs: [], widget_id: widgetId,
      layer_id: 'L1', params: { 'time_of_day.position': 0.30 },
    }],
    bindings: [{
      param_key: 'time_of_day.position', label: 'Time', control_type: 'slider',
      target: { node_id: nodeId, param_key: 'time_of_day.position' },
      control_schema: { control_type: 'slider', min: 0, max: 1, step: 0.001 },
      value: 0.30, default: 0.30,
    }],
    ...overrides,
  });
}
