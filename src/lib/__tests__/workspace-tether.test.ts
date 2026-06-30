import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { tetherWorkspaceWidget } from '../workspace-tether';
import type { Widget } from '@/types/widget';

function makeWidget(id = 'w_test'): Widget {
  return {
    id,
    intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'tool_invoked', prompt: null, parentWidgetId: null },
    opId: 'grain',
    composed: false,
    nodes: [
      { id: `n_${id}`, type: 'grain', opId: 'grain', params: {}, layerId: 'l1' },
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

  it('spawns successive widgets at distinct, non-overlapping positions', () => {
    tetherWorkspaceWidget(makeWidget('w_a'));
    tetherWorkspaceWidget(makeWidget('w_b'));
    tetherWorkspaceWidget(makeWidget('w_c'));
    const wn = useEditorStore.getState().widgetNodes;
    const positions = [wn.w_a?.position, wn.w_b?.position, wn.w_c?.position];
    expect(positions.every(Boolean)).toBe(true);
    const keys = positions.map((p) => `${p!.x},${p!.y}`);
    expect(new Set(keys).size).toBe(3); // all distinct — no stacking on one spot
  });

  it('clears a prior widget\'s real (expanded) footprint, not the 52px estimate', () => {
    tetherWorkspaceWidget(makeWidget('w_a'));
    const a = useEditorStore.getState().widgetNodes.w_a!;
    // Simulate React Flow having measured w_a as a tall, expanded widget.
    useEditorStore.setState((s) => {
      s.widgetNodes.w_a = { ...s.widgetNodes.w_a!, size: { w: 280, h: 300 } };
    });
    tetherWorkspaceWidget(makeWidget('w_b'));
    const b = useEditorStore.getState().widgetNodes.w_b!;
    // w_b must not overlap w_a's REAL (measured) footprint — whether it stacks
    // below or overflows to the opposite column. With the old 52px estimate it
    // landed inside w_a's expanded body.
    const aRect = { x0: a.position.x, y0: a.position.y, x1: a.position.x + 280, y1: a.position.y + 300 };
    const bRect = { x0: b.position.x, y0: b.position.y, x1: b.position.x + 280, y1: b.position.y + 300 };
    const overlap = aRect.x0 < bRect.x1 && bRect.x0 < aRect.x1 && aRect.y0 < bRect.y1 && bRect.y0 < aRect.y1;
    expect(overlap).toBe(false);
  });
});
