import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, beforeEach, afterEach } from 'vitest';
import { ToolSection } from './ToolSection';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ProcessingDefinition } from '@/types/processing';
import { Sun } from 'lucide-react';

const lightDef = {
  id: 'light',
  label: 'Light',
  icon: Sun,
  category: 'adjust',
  adjustmentType: 'basic',
  params: [{ key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 }],
  Panel: () => null,
} as unknown as ProcessingDefinition;

beforeEach(() => {
  useEditorStore.setState({ expandedSectionIds: new Set(), activeLayerId: 'L1' } as never);
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    optimistic: new Map(),
    snapshot: {
      session_id: 's1',
      image_context: null,
      widgets: [],
      masks_index: [],
      operation_graph: {
        id: 'g',
        userGoal: '',
        nodes: [{ id: 'canon:L1:basic', type: 'basic', layer_id: 'L1', params: { exposure: 12 } }],
        panelBindings: [],
        metadata: {},
      },
      revision: 1,
    } as never,
  } as never);
});
afterEach(() => cleanup());

it('collapsed shows the touched-slider count badge (not the per-edit text)', () => {
  render(<ToolSection def={lightDef} layerId="L1" />);
  // One non-default param → badge reads "1". No per-edit text, no dirty dot.
  const badge = screen.getByTestId('touched-count');
  expect(badge.textContent).toBe('1');
  expect(screen.queryByText('Exposure +12')).toBeNull();
  expect(screen.queryByTestId('dirty-dot')).toBeNull();
});

it('hides the badge entirely when no slider has been touched', () => {
  useBackendState.setState({
    snapshot: {
      ...useBackendState.getState().snapshot!,
      operation_graph: {
        id: 'g', userGoal: '',
        nodes: [{ id: 'canon:L1:basic', type: 'basic', layer_id: 'L1', params: { exposure: 0 } }],
        panelBindings: [], metadata: {},
      },
    } as never,
  } as never);
  render(<ToolSection def={lightDef} layerId="L1" />);
  expect(screen.queryByTestId('touched-count')).toBeNull();
});

it('clicking the header expands and renders the scalar body', () => {
  render(<ToolSection def={lightDef} layerId="L1" />);
  fireEvent.click(screen.getByText('Light'));
  expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(true);
  expect(screen.getByRole('slider')).toBeTruthy();
});
