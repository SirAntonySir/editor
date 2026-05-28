import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InspectorPanel } from './InspectorPanel';
import { useBackendState } from '@/store/backend-state-slice';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { maskStore } from '@/core/mask-store';

beforeEach(() => {
  useBackendState.getState().reset();
  useSegmentSelection.getState().clear();
});

afterEach(() => cleanup());

describe('InspectorPanel — four-section layout', () => {
  it('shows empty selection hint when nothing selected', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/click a segment/i)).toBeDefined();
  });

  it('shows selection card when selectedSegmentId is set', () => {
    const ref = maskStore.register({
      layerId: 'l1', label: 'sky', width: 4, height: 4,
      data: new Uint8Array([1,1,1,1, 1,1,1,1, 0,0,0,0, 0,0,0,0]),
      source: 'sam-point', createdAt: 0,
    });
    useSegmentSelection.setState({ selectedSegmentId: ref });
    render(<InspectorPanel />);
    expect(screen.getByText('sky')).toBeDefined();
    expect(screen.getByText(/\d+%/)).toBeDefined();
  });

  it('renders suggestions section when autonomous widgets present', () => {
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
    expect(screen.getByText(/suggestions/i)).toBeDefined();
  });
});
