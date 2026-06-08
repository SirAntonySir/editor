import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { ReactNode } from 'react';
import { WidgetShell, WIDGET_COLLAPSED_WIDTH } from './WidgetShell';
import { makeAiWidget, makeToolWidget, makeHslWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

function flowWrapper({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

function renderInFlow(ui: ReactNode) {
  return render(ui, { wrapper: flowWrapper });
}

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
    const ids = Array.from(useEditorStore.getState().hiddenWidgetIds);
    for (const id of ids) useEditorStore.getState().toggleWidgetHidden(id);
    vi.clearAllMocks();
  });

  it('renders as collapsed strip by default', () => {
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('expands on header click', () => {
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle widget/i }));
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('Apply calls backendTools.accept_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1' });
  });

  it('Close (×) calls backendTools.delete_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /close widget/i }));
    expect(backendTools.delete_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1', suppress_similar: false });
  });

  it('tool_invoked widget shows NO Refine and NO Why when expanded', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-tool-1');
    renderInFlow(<WidgetShell widget={makeToolWidget()} />);
    expect(screen.queryByText(/refine/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/why\?/i)).not.toBeInTheDocument();
  });

  it('mcp_autonomous widget shows Refine when expanded', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
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
    renderInFlow(<WidgetShell widget={widget} />);

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
    renderInFlow(<WidgetShell widget={widget} />);
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
    renderInFlow(<WidgetShell widget={makeHslWidget(ALL_BANDS)} />);
    expect(screen.getByText('By band')).toBeInTheDocument();
    expect(screen.getByText('By channel')).toBeInTheDocument();
  });

  it('routes a single-band HSL widget to a 3-slider colour body (no view toggle)', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-hsl-1');
    renderInFlow(<WidgetShell widget={makeHslWidget(['blue'])} />);
    expect(screen.queryByText('By band')).not.toBeInTheDocument();
    expect(screen.getAllByRole('slider').length).toBe(3);
  });

  it('non-HSL widget still renders binding rows, not the HSL panel', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.queryByText('By band')).not.toBeInTheDocument();
  });

  it('applies opacity-60 to the shell root when the widget id is in hiddenWidgetIds', () => {
    useEditorStore.getState().toggleWidgetHidden('w-ai-1');
    const { container } = renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    expect(container.firstChild as HTMLElement).toHaveClass('opacity-60');
  });

  it('clicking the eye button calls toggleWidgetHidden on the store', () => {
    renderInFlow(<WidgetShell widget={makeAiWidget()} />);
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-ai-1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /hide widget/i }));
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-ai-1')).toBe(true);
  });
});

describe('selection glow', () => {
  beforeEach(() => {
    const ids = Array.from(useEditorStore.getState().hiddenWidgetIds);
    for (const id of ids) useEditorStore.getState().toggleWidgetHidden(id);
  });

  it('applies .workspace-node-selected when selected and NOT AI', () => {
    renderInFlow(<WidgetShell widget={makeToolWidget()} selected />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(true);
    expect(overlay.classList.contains('widget-shell-ai')).toBe(false);
  });

  it('keeps violet (widget-shell-ai) when selected AND AI — does not add accent glow', () => {
    renderInFlow(<WidgetShell widget={makeAiWidget()} selected />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('widget-shell-ai')).toBe(true);
    expect(overlay.classList.contains('workspace-node-selected')).toBe(false);
  });

  it('omits both glow classes when not selected and tool-invoked', () => {
    renderInFlow(<WidgetShell widget={makeToolWidget()} selected={false} />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(false);
    expect(overlay.classList.contains('widget-shell-ai')).toBe(false);
  });
});

describe('WidgetShell collapsed pill width', () => {
  it('exports WIDGET_COLLAPSED_WIDTH = 226', () => {
    expect(WIDGET_COLLAPSED_WIDTH).toBe(226);
  });
});

describe('WidgetShell zoom-invariant scale', () => {
  it('applies a transform-scale style derived from React Flow zoom', () => {
    const widget = makeAiWidget();
    const { container } = renderInFlow(<WidgetShell widget={widget} />);
    const shell = container.querySelector('.overlay') ?? container.firstElementChild;
    expect(shell?.getAttribute('style') ?? '').toMatch(/scale\(1\)/);
  });
});

describe('WidgetShell ellipsis title', () => {
  beforeEach(() => {
    useEditorStore.getState().collapseAllWidgets();
  });

  it('truncates long titles with ellipsis in collapsed state', () => {
    const widget = makeAiWidget({
      display_name: 'A very long widget name that should not stretch the pill wider',
    });
    const { container } = renderInFlow(<WidgetShell widget={widget} />);
    const titleEl = container.querySelector('.widget-title-ellipsis');
    expect(titleEl).not.toBeNull();
  });
});
