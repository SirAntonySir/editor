import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorPanel, INSPECTOR_SHOW_INFO_EVENT } from './InspectorPanel';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

beforeEach(() => {
  useBackendState.getState().reset();
  useEditorStore.getState().clearSelection();
});

afterEach(() => cleanup());

describe('InspectorPanel — Suggestions / Layers', () => {
  it('renders Suggestions and Layers section headings (ActiveSection removed)', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/suggestions/i)).toBeDefined();
    expect(screen.getByText(/layers/i)).toBeDefined();
  });

  it('does not render the Ask AI inline input (moved to command palette)', () => {
    render(<InspectorPanel />);
    expect(screen.queryByPlaceholderText(/ask ai/i)).toBeNull();
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

describe('InspectorPanel — tab switcher', () => {
  it('defaults to the Adjustments tab and shows Suggestions/Layers', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/suggestions/i)).toBeDefined();
    expect(screen.getByText(/^layers$/i)).toBeDefined();
  });

  it('clicking Info hides Suggestions and renders the Info empty state', async () => {
    const user = userEvent.setup();
    render(<InspectorPanel />);
    await user.click(screen.getByText('Info'));
    expect(screen.queryByText(/suggestions/i)).toBeNull();
    expect(screen.getByText('No image context yet')).toBeDefined();
  });

  it('switches to the Info tab on the inspector:show-info window event', () => {
    render(<InspectorPanel />);
    expect(screen.getByText(/suggestions/i)).toBeDefined();
    act(() => { window.dispatchEvent(new Event(INSPECTOR_SHOW_INFO_EVENT)); });
    expect(screen.queryByText(/suggestions/i)).toBeNull();
    expect(screen.getByText('No image context yet')).toBeDefined();
  });
});
