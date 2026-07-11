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
        paramKey: 'exposure', label: 'Exposure', controlType: 'slider',
        target: { nodeId: 'n-1', paramKey: 'exposure' },
        controlSchema: { controlType: 'slider', min: -1, max: 1, step: 0.01 },
        value: 0.4, default: 0,
      },
    ],
    preview: { kind: 'histogram_delta', autoBeforeAfter: false },
    rejectedAttempts: [],
    status: 'active',
    revision: 1,
    lockedParams: [],
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
    ...overrides,
  } as Widget;
}

export function makeToolWidget(overrides: Partial<Widget> = {}): Widget {
  return makeAiWidget({
    id: 'w-tool-1',
    intent: 'Light',
    reasoning: undefined,
    origin: { kind: 'tool_invoked' },
    opId: 'light',
    scope: { kind: 'global' },
    preview: { kind: 'none', autoBeforeAfter: false },
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
    opId: bands.length === 1 ? `hsl_${bands[0]}` : 'hsl',
    scope: { kind: 'global' },
    preview: { kind: 'none', autoBeforeAfter: false },
    nodes: [{
      id: nodeId, type: 'hsl', scope: { kind: 'global' }, inputs: [], widgetId: 'w-hsl-1',
      layerId: 'L1', params: Object.fromEntries(keys.map((k) => [k, 0])),
    }],
    bindings: keys.map((k) => ({
      paramKey: k, label: k.replace('_', ' '), controlType: 'slider',
      target: { nodeId: nodeId, paramKey: k },
      controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
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

/** A light (exposure) widget. Its sole binding is `exposure`. */
export function makeTimeOfDayWidget(overrides: Partial<Widget> = {}): Widget {
  const nodeId = 'n-light';
  const widgetId = 'w-light-tod';
  return makeAiWidget({
    id: widgetId,
    intent: 'Light',
    reasoning: undefined,
    origin: { kind: 'tool_invoked' },
    opId: 'light',
    scope: { kind: 'global' },
    preview: { kind: 'none', autoBeforeAfter: false },
    nodes: [{
      id: nodeId, type: 'basic', scope: { kind: 'global' }, inputs: [], widgetId: widgetId,
      layerId: 'L1', params: { exposure: 0 },
    }],
    bindings: [{
      paramKey: 'exposure', label: 'Exposure', controlType: 'slider',
      target: { nodeId: nodeId, paramKey: 'exposure' },
      controlSchema: { controlType: 'slider', min: -1, max: 1, step: 0.01 },
      value: 0, default: 0,
    }],
    ...overrides,
  });
}
