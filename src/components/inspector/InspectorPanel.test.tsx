import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorPanel, INSPECTOR_SHOW_INFO_EVENT } from './InspectorPanel';
import { registerAllProcessing } from '@/processing';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

beforeEach(() => {
  registerAllProcessing();
  useBackendState.getState().reset();
  useEditorStore.getState().clearSelection();
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    optimistic: new Map(),
    snapshot: {
      session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
      revision: 1,
    },
  } as never);
});

afterEach(() => cleanup());

describe('InspectorPanel — adjustments tab', () => {
  it('shows the accordion tools, not a Layers section', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.queryByText('Layers')).toBeNull();
  });

  it('does not render the Ask AI inline input (moved to command palette)', () => {
    render(<InspectorPanel />);
    expect(screen.queryByPlaceholderText(/ask ai/i)).toBeNull();
  });
});

describe('InspectorPanel — tab switcher', () => {
  it('defaults to the Adjustments tab and shows the accordion tools', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('Light')).toBeTruthy();
  });

  it('clicking Info hides the accordion and renders the Info empty state', async () => {
    const user = userEvent.setup();
    render(<InspectorPanel />);
    await user.click(screen.getByText('Info'));
    expect(screen.queryByText('Light')).toBeNull();
    expect(screen.getByText('Analyze this image')).toBeDefined();
  });

  it('switches to the Info tab on the inspector:show-info window event', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('Light')).toBeTruthy();
    act(() => { window.dispatchEvent(new Event(INSPECTOR_SHOW_INFO_EVENT)); });
    expect(screen.queryByText('Light')).toBeNull();
    expect(screen.getByText('Analyze this image')).toBeDefined();
  });
});
