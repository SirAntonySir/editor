import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { planMergeVisible, resolveWidgetsForMergedLayers } from './merge-visible-layers';
import { useBackendState } from '@/store/backend-state-slice';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { backendTools } from '@/lib/backend-tools';
import type { Widget } from '@/types/widget';

const visibleOf = (set: Set<string>) => (id: string) => set.has(id);

describe('planMergeVisible', () => {
  it('collapses contiguous visible layers to the merged id at the bottommost slot', () => {
    // order is bottom→top: a (bottom) … c (top)
    const { newLayerIds, removedIds } = planMergeVisible(
      ['a', 'b', 'c'],
      visibleOf(new Set(['a', 'b', 'c'])),
      'M',
    );
    expect(newLayerIds).toEqual(['M']);
    expect(removedIds).toEqual(['a', 'b', 'c']);
  });

  it('keeps hidden layers in their original positions', () => {
    // a visible, b hidden, c visible  → merged sits at a's slot, b stays, c gone
    const { newLayerIds, removedIds } = planMergeVisible(
      ['a', 'b', 'c'],
      visibleOf(new Set(['a', 'c'])),
      'M',
    );
    expect(newLayerIds).toEqual(['M', 'b']);
    expect(removedIds).toEqual(['a', 'c']);
  });

  it('places the merged id at the bottommost visible slot when hidden is below', () => {
    // h (hidden, bottom), a, b (visible) → hidden stays at bottom, merged above it
    const { newLayerIds, removedIds } = planMergeVisible(
      ['h', 'a', 'b'],
      visibleOf(new Set(['a', 'b'])),
      'M',
    );
    expect(newLayerIds).toEqual(['h', 'M']);
    expect(removedIds).toEqual(['a', 'b']);
  });

  it('preserves a hidden layer on top', () => {
    const { newLayerIds } = planMergeVisible(
      ['a', 'b', 'top'],
      visibleOf(new Set(['a', 'b'])),
      'M',
    );
    expect(newLayerIds).toEqual(['M', 'top']);
  });
});

describe('resolveWidgetsForMergedLayers', () => {
  const makeWidget = (id: string, layerId: string, status = 'active'): Widget =>
    ({
      id, status, intent: id,
      nodes: [{ id: `n-${id}`, type: 'basic', params: {}, layerId, widgetId: id, inputs: [], scope: { kind: 'global' } }],
      bindings: [],
    }) as unknown as Widget;

  beforeEach(() => {
    useBackendState.getState().setSessionId('sid-1');
    useSuggestionsUi.getState().markPending([]);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    useBackendState.getState().reset();
  });

  it('accepts engaged widgets on merged layers and dismisses pending ones; leaves others', () => {
    const accept = vi.spyOn(backendTools, 'accept_widget').mockResolvedValue({ ok: true } as never);
    const del = vi.spyOn(backendTools, 'delete_widget').mockResolvedValue({ ok: true } as never);
    useBackendState.setState({
      snapshot: {
        widgets: [
          makeWidget('w-engaged', 'l-a'),           // engaged, on a merged layer → accept
          makeWidget('w-pending', 'l-b'),           // pending suggestion → dismiss (never approved)
          makeWidget('w-elsewhere', 'l-other'),     // different image → untouched
          makeWidget('w-dismissed', 'l-a', 'dismissed'), // already gone → untouched
        ],
      },
    } as never);
    useSuggestionsUi.getState().markPending(['w-pending']);

    resolveWidgetsForMergedLayers(['l-a', 'l-b']);

    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith('sid-1', { widgetId: 'w-engaged' });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('sid-1', { widgetId: 'w-pending', suppressSimilar: false });
  });

  it('no-ops without a backend session', () => {
    const accept = vi.spyOn(backendTools, 'accept_widget').mockResolvedValue({ ok: true } as never);
    useBackendState.getState().reset();
    useBackendState.setState({ snapshot: { widgets: [makeWidget('w1', 'l-a')] } } as never);

    resolveWidgetsForMergedLayers(['l-a']);

    expect(accept).not.toHaveBeenCalled();
  });
});
