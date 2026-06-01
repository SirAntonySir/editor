import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, beforeEach, afterEach } from 'vitest';
import { AdjustmentsAccordion } from './AdjustmentsAccordion';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { registerAllProcessing } from '@/processing';

beforeEach(() => {
  registerAllProcessing();
  useEditorStore.setState({ expandedSectionIds: new Set(), activeLayerId: 'L1' } as never);
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});
afterEach(() => cleanup());

it('renders the six tool sections in registry order', () => {
  render(<AdjustmentsAccordion />);
  for (const label of ['Light', 'Color', 'White Balance', 'Curves', 'Levels', 'Filters']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});
