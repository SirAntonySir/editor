import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { WidgetShell } from './WidgetShell';
import { makeAiWidget, makeToolWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    accept_widget: vi.fn(),
    delete_widget: vi.fn(),
    refine_widget: vi.fn(),
  },
}));

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  return {
    ...actual,
    useBackendState: Object.assign(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (selector: (s: any) => any) => selector({
        sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open',
      }),
      { getState: () => ({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open' }) },
    ),
  };
});

afterEach(cleanup);

describe('WidgetShell', () => {
  beforeEach(() => {
    useEditorStore.getState().collapseAllWidgets();
    vi.clearAllMocks();
  });

  it('renders as collapsed strip by default', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('expands on header click', () => {
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle widget/i }));
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('Apply calls backendTools.accept_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1' });
  });

  it('Close (×) calls backendTools.delete_widget', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    fireEvent.click(screen.getByRole('button', { name: /close widget/i }));
    expect(backendTools.delete_widget).toHaveBeenCalledWith('s-1', { widget_id: 'w-ai-1', suppress_similar: false });
  });

  it('tool_invoked widget shows NO Refine and NO Why when expanded', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-tool-1');
    render(<WidgetShell widget={makeToolWidget()} />);
    expect(screen.queryByText(/refine/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/why\?/i)).not.toBeInTheDocument();
  });

  it('mcp_autonomous widget shows Refine when expanded', () => {
    useEditorStore.getState().toggleWidgetExpanded('w-ai-1');
    render(<WidgetShell widget={makeAiWidget()} />);
    expect(screen.getByText(/refine/i)).toBeInTheDocument();
  });
});
