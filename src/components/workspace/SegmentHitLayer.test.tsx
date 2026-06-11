import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SegmentHitLayer } from './SegmentHitLayer';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';

vi.mock('@/hooks/useMobileSam', () => ({
  useMobileSam: () => ({ ready: true, error: null, decode: vi.fn(async () => null) }),
}));

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_mask: vi.fn(async () => ({ ok: true, output: { maskId: 'new-mask' } })),
  },
}));

const region = (id: string, label: string) => ({
  label,
  description: '',
  paths: [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]] as [number, number][]],
  maskRef: id,
});

describe('SegmentHitLayer', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
    // SegmentHitLayer reads directly from useAiSession context.candidateRegions,
    // not segmentStore — seed it here so the component sees the test regions.
    useAiSession.setState({
      context: {
        subjects: [],
        lighting: 'flat',
        dominantTones: [],
        mood: '',
        candidateRegions: [region('mask-a', 'dog'), region('mask-b', 'sky')],
        modelName: 't',
        modelVersion: '1',
        generatedAt: '2026-06-11T00:00:00Z',
      },
    });
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
