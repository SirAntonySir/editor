import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SegmentHitLayer } from './SegmentHitLayer';
import { useEditorStore } from '@/store';
import { segmentStore } from '@/lib/segmentation/segment-store';

const region = (id: string, label: string) => ({
  label,
  description: '',
  paths: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]] as [number, number][]],
  maskRef: id,
});

describe('SegmentHitLayer', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
    segmentStore.clearAll();
    segmentStore.setRegions('in-1', [region('mask-a', 'dog'), region('mask-b', 'sky')]);
  });

  it('pointer-move inside a region sets hoveredScope', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    // Stub getBoundingClientRect — jsdom returns 0×0 otherwise.
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    expect(useEditorStore.getState().hoveredScope?.kind).toBe('mask');
  });

  it('pointer-move outside any region clears hoveredScope', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(layer, { clientX: 350, clientY: 250 });
    expect(useEditorStore.getState().hoveredScope).toBeNull();
  });

  it('click inside a region sets activeScope to a mask scope', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(layer, { clientX: 50, clientY: 50 });
    expect(useEditorStore.getState().activeScope.kind).toBe('mask');
  });

  it('click on empty area clears the selection (clickAt with no candidates)', () => {
    const { container } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = container.querySelector('[data-testid="segment-hit-layer"]') as HTMLElement;
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(layer, { clientX: 350, clientY: 250 });
    expect(useEditorStore.getState().activeScope.kind).toBe('global');
  });
});
