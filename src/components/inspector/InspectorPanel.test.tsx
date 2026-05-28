import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useBackendState } from '@/store/backend-state-slice';
import { InspectorPanel } from './InspectorPanel';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    accept_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    refine_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    repeat_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    delete_widget: vi.fn().mockResolvedValue({ ok: true, output: {} }),
    preview_widget: vi.fn().mockResolvedValue({ ok: true, output: { mime_type: 'image/jpeg', image_b64: null } }),
  },
}));

vi.mock('@/components/EditorProvider', () => ({
  useEditor: () => ({
    toolContext: {},
    getActiveTool: () => undefined,
  }),
}));

beforeEach(() => {
  useBackendState.getState().reset();
});

afterEach(() => {
  cleanup();
});

describe('InspectorPanel (widget-driven inspector)', () => {
  it('renders suggestions and active widgets in separate sections', () => {
    useBackendState.setState({
      sessionId: 's1',
      snapshot: {
        session_id: 's1',
        image_context: null,
        widgets: [
          {
            id: 'sug', intent: 'Recover sky', scope: { kind: 'global' },
            origin: { kind: 'mcp_autonomous', prompt: null }, composed: false,
            nodes: [], bindings: [], preview: { kind: 'thumbnail', auto_before_after: true },
            rejected_attempts: [], status: 'active', revision: 1,
            created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z',
          },
          {
            id: 'act', intent: 'Warmer skin', scope: { kind: 'global' },
            origin: { kind: 'mcp_user_prompt', prompt: 'warmer' }, composed: false,
            nodes: [], bindings: [], preview: { kind: 'thumbnail', auto_before_after: true },
            rejected_attempts: [], status: 'active', revision: 1,
            created_at: '2026-05-23T00:00:00Z', updated_at: '2026-05-23T00:00:00Z',
          },
        ],
        masks_index: [],
        operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      },
    });
    render(<InspectorPanel />);
    expect(screen.getByText('Recover sky')).toBeDefined();
    expect(screen.getByText('Warmer skin')).toBeDefined();
    expect(screen.getByText(/suggestions/i)).toBeDefined();
    expect(screen.getByText(/active widgets/i)).toBeDefined();
  });
});
