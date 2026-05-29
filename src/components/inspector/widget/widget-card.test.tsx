import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WidgetCard } from './WidgetCard';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    accept_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    refine_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    repeat_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    delete_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    preview_widget: vi.fn().mockResolvedValue({ ok: true, output: { mime_type: 'image/jpeg', image_b64: null } }),
  },
}));

const suggestion: Widget = {
  id: 'w_s',
  intent: 'Recover sky',
  scope: { kind: 'global' },
  origin: { kind: 'mcp_autonomous', prompt: null },
  composed: false,
  nodes: [],
  bindings: [],
  preview: { kind: 'thumbnail', auto_before_after: true },
  rejected_attempts: [],
  status: 'active',
  revision: 1,
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T00:00:00Z',
};

const active: Widget = {
  ...suggestion,
  id: 'w_a',
  intent: 'Warmer skin',
  origin: { kind: 'mcp_user_prompt', prompt: 'warmer' },
  bindings: [
    {
      param_key: 'temperature', label: 'Temperature', control_type: 'slider',
      target: { node_id: 'n_1', param_key: 'temperature' },
      control_schema: { control_type: 'slider', min: 3000, max: 9000, step: 50 },
      value: 6500, default: 5500,
    },
  ],
};

beforeEach(async () => {
  useBackendState.getState().reset();
  useBackendState.setState({ sessionId: 's1' });
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('WidgetCard suggestion mode', () => {
  it('renders intent and Accept/Dismiss buttons', () => {
    render(<WidgetCard widget={suggestion} isSuggestion />);
    expect(screen.getByText('Recover sky')).toBeDefined();
    expect(screen.getByRole('button', { name: /accept/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /dismiss suggestion/i })).toBeDefined();
  });

  it('calls accept_widget when Accept is clicked', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    render(<WidgetCard widget={suggestion} isSuggestion />);
    const accept = screen.getByRole('button', { name: /accept/i });
    await userEvent.click(accept);
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s1', { widget_id: 'w_s' });
  });
});

describe('WidgetCard active mode', () => {
  it('renders bindings and lifecycle actions', () => {
    render(<WidgetCard widget={active} isSuggestion={false} />);
    expect(screen.getByText('Warmer skin')).toBeDefined();
    expect(screen.getByText('Temperature')).toBeDefined();
    expect(screen.getByRole('button', { name: /refine/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /repeat/i })).toBeDefined();
  });

  it('calls set_widget_param + applyOptimistic when slider changes', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({
      snapshot: {
        session_id: 's1', image_context: null, widgets: [active],
        masks_index: [], operation_graph: { id: 'g', userGoal: '', reasoning: undefined, nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      },
    });
    render(<WidgetCard widget={active} isSuggestion={false} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    // Direct change via fireEvent — userEvent on range inputs is unreliable.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(slider, { target: { value: '7000' } });
    expect(useBackendState.getState().optimistic.has('w_a')).toBe(true);
    expect(backendTools.set_widget_param).toHaveBeenCalledWith('s1', {
      widget_id: 'w_a', param_key: 'temperature', value: 7000,
    });
  });
});
