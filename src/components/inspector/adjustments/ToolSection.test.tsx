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

it('collapsed shows the canonical summary and a dirty dot', () => {
  render(<ToolSection def={lightDef} layerId="L1" />);
  expect(screen.getByText('Exposure +12')).toBeTruthy();
  expect(screen.getByTestId('dirty-dot')).toBeTruthy();
});

it('clicking the header expands and renders the scalar body', () => {
  render(<ToolSection def={lightDef} layerId="L1" />);
  fireEvent.click(screen.getByText('Light'));
  expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(true);
  expect(screen.getByRole('slider')).toBeTruthy();
});
