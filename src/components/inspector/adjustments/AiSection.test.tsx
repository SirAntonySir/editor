import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiSection } from './AiSection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { registerAllProcessing } from '@/processing';
import type { Widget } from '@/types/widget';

registerAllProcessing();

vi.mock('@/lib/backend-tools', () => ({ backendTools: {
  accept_widget: vi.fn().mockResolvedValue({ ok: true }),
  delete_widget: vi.fn().mockResolvedValue({ ok: true }),
  set_widget_param: vi.fn().mockResolvedValue({ ok: true }),
} }));

const widget = {
  id: 'w1', intent: 'Warm the sky', status: 'active',
  origin: { kind: 'mcp_autonomous' }, scope: { root: { kind: 'global' } },
  nodes: [{ id: 'canon:L1:kelvin', type: 'kelvin', layer_id: 'L1', params: { kelvin: 6200 } }],
  bindings: [], preview: { kind: 'none' },
} as unknown as Widget;

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    expandedSectionIds: new Set(['w1']), activeLayerId: 'L1',
    widgetNodes: {}, tetherEdges: {},
    imageNodes: { img1: { id: 'img1', layerIds: ['L1'], position: { x: 0, y: 0 }, size: { width: 800, height: 600 } } },
    activeImageNodeId: 'img1',
  } as never);
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [widget], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: widget.nodes as never, panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});
afterEach(() => cleanup());

it('renders the intent and Apply commits the widget', () => {
  render(<AiSection widget={widget} />);
  expect(screen.getByText('Warm the sky')).toBeTruthy();
  fireEvent.click(screen.getByText('Apply'));
  expect(backendTools.accept_widget).toHaveBeenCalledWith('s1', { widget_id: 'w1' });
});

it('header × discards the widget', () => {
  render(<AiSection widget={widget} />);
  fireEvent.click(screen.getByLabelText('Close'));
  expect(backendTools.delete_widget).toHaveBeenCalledWith('s1', { widget_id: 'w1', suppress_similar: false });
});

it('the arrow engages the suggestion onto the canvas, then disables once placed', () => {
  render(<AiSection widget={widget} />);
  const arrow = screen.getByLabelText('Open on canvas');
  expect((arrow as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(arrow);
  expect(useEditorStore.getState().widgetNodes['w1']).toBeTruthy();
  cleanup();
  render(<AiSection widget={widget} />);
  expect((screen.getByLabelText('Already on canvas') as HTMLButtonElement).disabled).toBe(true);
});

it('renders an op header for each underlying node so multi-op widgets show their composition', () => {
  // Multi-op widget: kelvin + basic (typical of warm_grade, cast_correct, …).
  const w = {
    id: 'w_multi', intent: 'Warm and pop', status: 'active',
    origin: { kind: 'mcp_autonomous' }, scope: { root: { kind: 'global' } },
    nodes: [
      { id: 'n_kelvin', type: 'kelvin', layer_id: 'L1', params: {} },
      { id: 'n_basic', type: 'basic', layer_id: 'L1', params: {} },
    ],
    bindings: [
      {
        param_key: 'temperature', label: 'Warmth', control_type: 'slider',
        control_schema: { control_type: 'slider', min: -2000, max: 2000, step: 50 },
        target: { node_id: 'n_kelvin', param_key: 'temperature' },
        value: 200, default: 200,
      },
      {
        param_key: 'saturation', label: 'Saturation', control_type: 'slider',
        control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
        target: { node_id: 'n_basic', param_key: 'saturation' },
        value: 5, default: 5,
      },
    ],
    preview: { kind: 'none' },
  } as unknown as Widget;
  useBackendState.setState({ snapshot: { ...useBackendState.getState().snapshot!, widgets: [w] } } as never);
  useEditorStore.setState({ expandedSectionIds: new Set(['w_multi']) } as never);

  render(<AiSection widget={w} />);
  // Both op headers are visible alongside the bindings.
  // kelvin processing def's label is 'White Balance' (see processing/kelvin.tsx).
  expect(screen.getByText('White Balance')).toBeTruthy();
  // 'basic' shaderBinding is shared by Light + Color processing defs.
  expect(screen.getByText('Light & Color')).toBeTruthy();
  expect(screen.getByText('Warmth')).toBeTruthy();
  expect(screen.getByText('Saturation')).toBeTruthy();
});

describe('eye visibility toggle', () => {
  beforeEach(() => {
    const ids = Array.from(useEditorStore.getState().hiddenWidgetIds);
    for (const id of ids) useEditorStore.getState().toggleWidgetHidden(id);
  });

  it('renders an Eye button labelled "Hide widget" when not hidden', () => {
    render(<AiSection widget={widget} />);
    expect(screen.getByRole('button', { name: /hide widget/i })).toBeInTheDocument();
  });

  it('clicking the eye toggles hiddenWidgetIds on the store and flips the aria-label', () => {
    render(<AiSection widget={widget} />);
    expect(useEditorStore.getState().hiddenWidgetIds.has(widget.id)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /hide widget/i }));
    expect(useEditorStore.getState().hiddenWidgetIds.has(widget.id)).toBe(true);
    expect(screen.getByRole('button', { name: /show widget/i })).toBeInTheDocument();
  });

  it('adds opacity-60 to the section root when hidden', () => {
    useEditorStore.getState().toggleWidgetHidden(widget.id);
    const { container } = render(<AiSection widget={widget} />);
    expect(container.firstChild as HTMLElement).toHaveClass('opacity-60');
  });
});

it('keys AI-suggestion optimistic preview on the canonical node id, not the widget node id', () => {
  const w = {
    id: 'w1', intent: 'Recover', status: 'active',
    origin: { kind: 'mcp_autonomous' }, scope: { root: { kind: 'global' } },
    nodes: [{ id: 'n_basic', type: 'basic', layer_id: 'L1', params: { highlights: 0 } }],
    bindings: [{
      param_key: 'highlights', label: 'Highlights', control_type: 'slider',
      control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
      target: { node_id: 'n_basic', param_key: 'highlights' },
      value: 0, default: 0,
    }],
    preview: { kind: 'none' },
  } as unknown as Widget;
  useBackendState.setState({ snapshot: { ...useBackendState.getState().snapshot!, widgets: [w] } } as never);
  render(<AiSection widget={w} />);
  // Drive the click-to-edit readout to trigger setParam
  const r = screen.getByTitle('Drag to scrub · click to type');
  fireEvent.pointerDown(r, { clientX: 0 });
  fireEvent.pointerUp(r, { clientX: 0 });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '40' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  const opt = useBackendState.getState().optimistic;
  expect(opt.has('canon:L1:basic')).toBe(true);
  expect(opt.has('n_basic')).toBe(false);
});
