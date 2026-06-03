import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorPanel } from './InspectorPanel';
import { registerAllProcessing } from '@/processing';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';

beforeEach(() => {
  registerAllProcessing();
  useBackendState.getState().reset();
  useEditorStore.getState().clearSelection();
  usePreferencesStore.setState({ inspectorTab: 'adjustments', rightSidebarCollapsed: false });
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

  it('switches to the Info tab when the store selects it (showImageContext)', () => {
    render(<InspectorPanel />);
    expect(screen.getByText('Light')).toBeTruthy();
    act(() => { usePreferencesStore.getState().showImageContext(); });
    expect(screen.queryByText('Light')).toBeNull();
    expect(screen.getByText('Analyze this image')).toBeDefined();
  });
});

describe('Crop tab', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ inspectorTab: 'adjustments', rightSidebarCollapsed: false });
    useEditorStore.setState({ activeImageNodeId: null } as never);
  });

  it('renders a Crop button next to Adjustments and Info', () => {
    render(<InspectorPanel />);
    expect(screen.getByRole('radio', { name: 'Crop' })).toBeInTheDocument();
  });

  it('disables the Crop tab when no active image-node', () => {
    render(<InspectorPanel />);
    expect(screen.getByRole('radio', { name: 'Crop' })).toBeDisabled();
  });

  it('enables the Crop tab when an image-node is active', () => {
    useEditorStore.setState({ activeImageNodeId: 'in-1' } as never);
    render(<InspectorPanel />);
    expect(screen.getByRole('radio', { name: 'Crop' })).not.toBeDisabled();
  });

  it('switches to crop tab on click and renders the CropTab placeholder', async () => {
    useEditorStore.setState({ activeImageNodeId: 'in-1' } as never);
    render(<InspectorPanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Crop' }));
    expect(usePreferencesStore.getState().inspectorTab).toBe('crop');
    expect(screen.getByTestId('crop-tab')).toBeInTheDocument();
  });
});
