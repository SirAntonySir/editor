import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InspectorPanel } from './InspectorPanel';
import { useBackendState } from '@/store/backend-state-slice';
import { useSegmentSelection } from '@/store/segment-selection-slice';

beforeEach(() => {
  useBackendState.getState().reset();
  useSegmentSelection.getState().clear();
});

afterEach(() => cleanup());

describe('InspectorPanel — Suggestions / Active / Layers', () => {
  it('renders the three section headings', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/suggestions/i)).toBeDefined();
    expect(screen.getByText(/active/i)).toBeDefined();
    expect(screen.getByText(/layers/i)).toBeDefined();
  });

  it('renders the Ask AI input at the top of Suggestions', () => {
    render(<InspectorPanel />);
    expect(screen.getByPlaceholderText(/ask ai/i)).toBeDefined();
  });

  it('renders an autonomous suggestion row', () => {
    useBackendState.setState({
      sessionId: 's1',
      snapshot: {
        session_id: 's1', image_context: null,
        widgets: [{
          id: 'w1', intent: 'Recover sky', scope: { kind: 'global' },
          origin: { kind: 'mcp_autonomous', prompt: null },
          composed: false, nodes: [], bindings: [],
          preview: { kind: 'thumbnail', auto_before_after: true },
          rejected_attempts: [], status: 'active', revision: 1,
          created_at: '2026-05-28T00:00:00Z', updated_at: '2026-05-28T00:00:00Z',
        }],
        masks_index: [],
        operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      },
    });
    render(<InspectorPanel />);
    expect(screen.getByText('Recover sky')).toBeDefined();
  });
});
