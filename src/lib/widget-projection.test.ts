import { describe, it, expect, beforeEach } from 'vitest';
import { selectAllWidgets } from './widget-projection';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

const baseSnapshot = () => ({
  session_id: 's1', image_context: null, widgets: [], masks_index: [],
  operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
  revision: 1,
});

beforeEach(() => {
  useBackendState.getState().reset();
  useEditorStore.getState().revertAll();
});

describe('selectAllWidgets', () => {
  it('returns empty when no widgets', () => {
    expect(selectAllWidgets()).toEqual([]);
  });

  it('projects AI widgets from snapshot', () => {
    useBackendState.setState({
      sessionId: 's1',
      snapshot: {
        ...baseSnapshot(),
        widgets: [{
          id: 'w_1', intent: 'Warm skin', scope: { kind: 'global' },
          origin: { kind: 'mcp_user_prompt', prompt: 'warmer' },
          composed: false, nodes: [], bindings: [],
          preview: { kind: 'thumbnail', auto_before_after: true },
          rejected_attempts: [], status: 'active', revision: 1,
          created_at: '2026-05-28T00:00:00Z', updated_at: '2026-05-28T00:00:00Z',
        }],
      },
    });
    const list = selectAllWidgets();
    expect(list).toHaveLength(1);
    expect(list[0].variant).toBe('ai');
    expect(list[0].id).toBe('w_1');
    expect(list[0].intent).toBe('Warm skin');
  });

  it('projects tool_invoked widget as variant=tool', () => {
    useBackendState.setState({
      sessionId: 's1',
      snapshot: {
        ...baseSnapshot(),
        widgets: [{
          id: 'w_tool', intent: 'Light adjustment', scope: { kind: 'global' },
          origin: { kind: 'tool_invoked' },
          fused_tool_id: 'light',
          composed: false, nodes: [], bindings: [],
          preview: { kind: 'thumbnail', auto_before_after: true },
          rejected_attempts: [], status: 'active', revision: 1,
          created_at: '2026-05-28T00:00:00Z', updated_at: '2026-05-28T00:00:00Z',
        }],
      },
    });
    const list = selectAllWidgets();
    expect(list).toHaveLength(1);
    expect(list[0].variant).toBe('tool');
    expect(list[0].processingId).toBe('light');
  });

  it('does NOT project AI widgets with status=dismissed', () => {
    useBackendState.setState({
      sessionId: 's1',
      snapshot: {
        ...baseSnapshot(),
        widgets: [{
          id: 'w_d', intent: 'Dismissed widget', scope: { kind: 'global' },
          origin: { kind: 'mcp_user_prompt', prompt: '' },
          composed: false, nodes: [], bindings: [],
          preview: { kind: 'thumbnail', auto_before_after: true },
          rejected_attempts: [], status: 'dismissed', revision: 1,
          created_at: '2026-05-28T00:00:00Z', updated_at: '2026-05-28T00:00:00Z',
        }],
      },
    });
    expect(selectAllWidgets()).toEqual([]);
  });
});
