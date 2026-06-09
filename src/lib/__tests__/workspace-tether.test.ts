import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { tetherWorkspaceWidget } from '../workspace-tether';
import type { Widget } from '@/types/widget';

function makeWidget(): Widget {
  return {
    id: 'w_test',
    intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'tool_invoked', prompt: null, parent_widget_id: null },
    op_id: 'grain',
    composed: false,
    nodes: [
      { id: 'n_a', type: 'grain', op_id: 'grain', params: {}, layer_id: 'l1' },
    ] as unknown as Widget['nodes'],
    bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    display_name: 'Grain',
    category: 'texture',
  };
}

describe('tetherWorkspaceWidget: spawn expanded', () => {
  beforeEach(() => {
    useEditorStore.setState((s) => ({
      ...s,
      imageNodes: {
        i1: {
          id: 'i1',
          position: { x: 0, y: 0 },
          size: { w: 300, h: 200 },
          layerIds: ['l1'],
        } as unknown as (typeof s.imageNodes)[string],
      },
      activeImageNodeId: 'i1',
      widgetNodes: {},
      expandedWidgetIds: new Set<string>(),
    }));
  });

  it('auto-expands the widget on spawn so its controls are immediately usable', () => {
    tetherWorkspaceWidget(makeWidget());
    const expanded = useEditorStore.getState().expandedWidgetIds;
    expect(expanded.has('w_test')).toBe(true);
  });
});
