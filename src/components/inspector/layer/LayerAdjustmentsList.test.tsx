import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerAllProcessing } from '@/processing';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { LayerAdjustmentsList } from './LayerAdjustmentsList';

vi.mock('./layer-adjustment-actions', () => ({
  copyCanonicalToLayer: vi.fn(),
  moveCanonicalToLayer: vi.fn(),
  resetCanonicalOnLayer: vi.fn(),
  setWidgetTargetChecked: vi.fn(),
  editCanonicalInAdjustments: vi.fn(),
}));

import {
  editCanonicalInAdjustments,
  setWidgetTargetChecked,
} from './layer-adjustment-actions';

registerAllProcessing();

function seedBackend({ nodes = [], widgets = [] }: { nodes?: unknown[]; widgets?: unknown[] }) {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: {
      sessionId: 's1', imageContext: null, widgets: widgets as never, masksIndex: [],
      operationGraph: { id: 'g', userGoal: '', nodes: nodes as never, panelBindings: [], metadata: {} },
      revision: 1,
    } as never,
    optimistic: new Map(),
  } as never);
}

const CANON_LIGHT = { id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 0.4 } };

function makeWidget(targets: string[]) {
  return {
    id: 'w1', displayName: 'Warm grade', intent: 'warm', status: 'active', category: 'color',
    nodes: [{ id: 'w1-n1', type: 'basic', params: {}, layerId: targets[0], layerIds: targets }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seedBackend({});
  useEditorStore.setState({
    expandedSectionIds: new Set<string>(),
    hiddenCanonNodeIds: new Set<string>(),
    hiddenWidgetIds: new Set<string>(),
    layers: [
      { id: 'L1', name: 'Sky', order: 1, visible: true, opacity: 1, blendMode: 'normal' },
      { id: 'L2', name: 'Boats', order: 0, visible: true, opacity: 1, blendMode: 'normal' },
    ],
    imageNodes: {
      node1: { id: 'node1', layerIds: ['L1', 'L2'] },
    },
  } as never);
});

it('renders nothing when the layer has no adjustments', () => {
  const { container } = render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  expect(container.textContent).toBe('');
});

it('shows a collapsed header with the entry count', () => {
  seedBackend({ nodes: [CANON_LIGHT], widgets: [makeWidget(['L1'])] });
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  expect(screen.getByText(/adjustments · 2/i)).toBeTruthy();
  expect(screen.queryByText('Light')).toBeNull();
});

it('expands via the header and records layeradj:<layerId> in the store', () => {
  seedBackend({ nodes: [CANON_LIGHT] });
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  fireEvent.click(screen.getByText(/adjustments · 1/i));
  expect(screen.getByText('Light')).toBeTruthy();
  expect(useEditorStore.getState().expandedSectionIds.has('layeradj:L1')).toBe(true);
});

it('marks multi-layer widgets with a layer-count hint', () => {
  seedBackend({ widgets: [makeWidget(['L1', 'L2'])] });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  expect(screen.getByText(/2 layers/i)).toBeTruthy();
});

it('canonical eye toggles hiddenCanonNodeIds for the canon node', () => {
  seedBackend({ nodes: [CANON_LIGHT] });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  fireEvent.click(screen.getByRole('button', { name: /hide light/i }));
  expect(useEditorStore.getState().hiddenCanonNodeIds.has('canon:L1:basic')).toBe(true);
});

it('widget eye toggles hiddenWidgetIds', () => {
  seedBackend({ widgets: [makeWidget(['L1'])] });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  fireEvent.click(screen.getByRole('button', { name: /hide warm grade/i }));
  expect(useEditorStore.getState().hiddenWidgetIds.has('w1')).toBe(true);
});

it('canonical menu: Edit in Adjustments routes to the section', async () => {
  seedBackend({ nodes: [CANON_LIGHT] });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  await userEvent.click(screen.getByRole('button', { name: /options for light/i }));
  await userEvent.click(await screen.findByText(/edit in adjustments/i));
  expect(editCanonicalInAdjustments).toHaveBeenCalledWith('L1', 'light');
});

it('widget menu: checking another layer adds it to the target set', async () => {
  seedBackend({ widgets: [makeWidget(['L1'])] });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  await userEvent.click(screen.getByRole('button', { name: /options for warm grade/i }));
  await userEvent.click(await screen.findByText('Boats'));
  expect(setWidgetTargetChecked).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'w1' }), 'L2', true,
  );
});

it('widget menu: the last checked target is disabled', async () => {
  seedBackend({ widgets: [makeWidget(['L1'])] });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  await userEvent.click(screen.getByRole('button', { name: /options for warm grade/i }));
  const sky = await screen.findByText('Sky');
  const item = sky.closest('[role="menuitemcheckbox"]');
  expect(item?.getAttribute('data-disabled')).not.toBeNull();
  await userEvent.click(sky);
  expect(setWidgetTargetChecked).not.toHaveBeenCalled();
});

it('renders Light and Color as separate rows without duplicate keys', () => {
  // Both defs project to canon:<layer>:basic — the rows must be keyed per
  // def, not per canon node, or React logs a duplicate-key error.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  seedBackend({
    nodes: [{
      id: 'canon:L1:basic', type: 'basic', layerId: 'L1',
      params: { exposure: 0.4, saturation: -21 },
    }],
  });
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  expect(screen.getByText('Light')).toBeTruthy();
  expect(screen.getByText('Color')).toBeTruthy();
  const dupKey = consoleError.mock.calls.find((c) => String(c[0]).includes('same key'));
  expect(dupKey).toBeUndefined();
  consoleError.mockRestore();
});

it('disables mutation menu items when offline', async () => {
  seedBackend({ widgets: [makeWidget(['L1', 'L2'])] });
  useBackendState.setState({ sseStatus: 'closed' } as never);
  useEditorStore.setState({ expandedSectionIds: new Set(['layeradj:L1']) } as never);
  render(<LayerAdjustmentsList layerId="L1" imageNodeId="node1" />);
  await userEvent.click(screen.getByRole('button', { name: /options for warm grade/i }));
  const boats = await screen.findByText('Boats');
  await userEvent.click(boats);
  expect(setWidgetTargetChecked).not.toHaveBeenCalled();
});
