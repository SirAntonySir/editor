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
    fused_tool_id: 'light',
    scope: { kind: 'global' },
    preview: { kind: 'none', auto_before_after: false },
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
