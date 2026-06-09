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

it('renders all tool-group sections (9 tools across 4 groups) and the Presets section', () => {
  render(<AdjustmentsAccordion />);
  for (const label of [
    // Group 1: tonal / luminance
    'Light', 'Levels', 'Curves',
    // Group 2: colour (Color appears in both tool list and Presets popover buttons)
    'White Balance', 'HSL',
    // Group 3: detail
    'Sharpen', 'Clarity', 'Blur',
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  // Color appears in both the tool section and the presets category button
  expect(screen.getAllByText('Color').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Presets')).toBeTruthy();
});

it('does not render the standalone Colour Band row (moved into HSL popover)', () => {
  render(<AdjustmentsAccordion />);
  expect(screen.queryByText('Colour band')).toBeNull();
});
