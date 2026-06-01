import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { WidgetShell } from './WidgetShell';
import { makeAiWidget, makeToolWidget, makeHslWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    accept_widget: vi.fn(),
    delete_widget: vi.fn(),
    refine_widget: vi.fn(),
  },
}));

const mockApplyOptimistic = vi.fn();

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  return {
    ...actual,
    useBackendState: Object.assign(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (selector: (s: any) => any) => selector({
        sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open',
      }),
      { getState: () => ({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open', applyOptimistic: mockApplyOptimistic }) },
    ),
  };
});

afterEach(cleanup);

describe('WidgetShell', () => {
  beforeEach(() => {
    useEditorStore.getState().collapseAllWidgets();
    vi.clearAllMocks();
  });

  it('renders as collapsed strip by default', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('expands on header click', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle widget/i }));
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('Apply calls backendTools.accept_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1' });
  });

  it('Close (×) calls backendTools.delete_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /close widget/i }));
    expect(backendTools.delete_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1', suppress_similar: false });
  });

  it('tool_invoked widget shows NO Refine and NO Why when expanded', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-tool-1');
    render(<WidgetShell widget={makeToolWidget()} />);
    expect(screen.queryByText(/refine/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/why\?/i)).not.toBeInTheDocument();
  });

  it('mcp_autonomous widget shows Refine when expanded', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.getByText(/refine/i)).toBeInTheDocument();
  });

  it('setParam keys the optimistic patch by binding.target.node_id, not widget id', () => {
    // Build a widget with a slider binding whose target.node_id is 'n_abc'
    const widget = makeAiWidget({
      bindings: [
        {
          param_key: 'exposure',
          label: 'Exposure',
          control_type: 'slider',
          target: { node_id: 'n_abc', param_key: 'exposure' },
          control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
          value: 0,
          default: 0,
        },
      ],
    });

    // Expand the shell so the slider is rendered
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={widget} />);

    // Drive the slider's onChange via the minimal AdjustmentSlider's number
    // field: a plain click (pointer down+up, no movement) opens the text input;
    // typing + Enter commits the value.
    const num = screen.getByTitle('Drag to scrub · click to type');
    fireEvent.pointerDown(num, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(num, { clientX: 0, pointerId: 1 });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The optimistic patch must be keyed by node_id ('n_abc'), not the widget id ('w-ai-1')
    expect(mockApplyOptimistic).toHaveBeenCalledWith(
      'n_abc',
      expect.objectContaining({
        bindings: [expect.objectContaining({ paramKey: 'exposure', value: 40 })],
      }),
    );
  });

  it('setParam keys the optimistic patch by CANONICAL node id when the widget node is known', () => {
    // When the binding's target node id resolves to a widget.nodes entry,
    // the optimistic key must be `canon:<layer>:<op>` — that's the id the
    // canvas renderer reads from when applying optimistic overrides, so
    // pixels update mid-drag instead of waiting for the SSE roundtrip.
    const widget = makeAiWidget({
      nodes: [
        { id: 'n_abc', type: 'basic', layer_id: 'L1', params: {}, scope: { kind: 'global' } } as never,
      ],
      bindings: [
        {
          param_key: 'exposure',
          label: 'Exposure',
          control_type: 'slider',
          target: { node_id: 'n_abc', param_key: 'exposure' },
          control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
          value: 0,
          default: 0,
        },
      ],
    });
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={widget} />);
    const num = screen.getByTitle('Drag to scrub · click to type');
    fireEvent.pointerDown(num, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(num, { clientX: 0, pointerId: 1 });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockApplyOptimistic).toHaveBeenCalledWith(
      'canon:L1:basic',
      expect.objectContaining({
        bindings: [expect.objectContaining({ paramKey: 'exposure', value: 40 })],
      }),
    );
  });

  const ALL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

  it('routes an all-bands HSL widget to the colour panel (By band / By channel)', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-hsl-1');
    render(<WidgetShell widget={makeHslWidget(ALL_BANDS)} />);
    expect(screen.getByText('By band')).toBeInTheDocument();
    expect(screen.getByText('By channel')).toBeInTheDocument();
  });

  it('routes a single-band HSL widget to a 3-slider colour body (no view toggle)', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-hsl-1');
    render(<WidgetShell widget={makeHslWidget(['blue'])} />);
    expect(screen.queryByText('By band')).not.toBeInTheDocument();
    expect(screen.getAllByRole('slider').length).toBe(3);
  });

  it('non-HSL widget still renders binding rows, not the HSL panel', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.queryByText('By band')).not.toBeInTheDocument();
  });
});
