import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiSection } from './AiSection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import type { Widget } from '@/types/widget';

vi.mock('@/lib/backend-tools', () => ({ backendTools: {
  accept_widget: vi.fn().mockResolvedValue({ ok: true }),
  delete_widget: vi.fn().mockResolvedValue({ ok: true }),
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
