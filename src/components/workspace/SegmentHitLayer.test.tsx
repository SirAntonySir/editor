import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { SegmentHitLayer } from './SegmentHitLayer';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import type { DecodedMask, SamPoint } from '@/lib/segmentation/mobile-sam-types';

const decodeMock = vi.fn<(points: SamPoint[]) => Promise<DecodedMask | null>>();

vi.mock('@/hooks/useMobileSam', () => ({
  useMobileSam: () => ({ ready: true, error: null, decode: decodeMock }),
}));

vi.mock('@/lib/segmentation/mask-png', () => ({
  maskToPngBase64: vi.fn(async () => 'stub-base64'),
}));

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_mask: vi.fn(async () => ({ ok: true, output: { maskId: 'new-mask' } })),
  },
}));

function fakeMask(width = 4, height = 4): DecodedMask {
  // 4×4 mask, top-left 2×2 quadrant is "on"
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width / 2; x++) {
      data[y * width + x] = 255;
    }
  }
  return { data, width, height };
}

function stubRect(layer: HTMLElement) {
  layer.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe('SegmentHitLayer — plain-click SAM 2 flow', () => {
  beforeEach(() => {
    decodeMock.mockReset();
    decodeMock.mockResolvedValue(fakeMask());
    (backendTools.propose_mask as ReturnType<typeof vi.fn>).mockClear();
    objectOwnership._resetForTests();
    useEditorStore.getState().clearSelection();
    useAiSession.setState({ sessionId: 'sess-1', context: null, status: 'idle', error: null });
  });

  it('plain click calls decode with one positive point', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeMock).toHaveBeenCalledTimes(1);
    const points = decodeMock.mock.calls[0][0];
    expect(points).toHaveLength(1);
    expect(points[0].label).toBe(1);
    expect(points[0].x).toBeCloseTo(0.25);
    expect(points[0].y).toBeCloseTo(0.25);
  });

  it('Enter after a successful decode commits via propose_mask with origin client_new', async () => {
    const { findByTestId, getByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    // Wait for the candidate to settle to mask-resolved state. The footer text
    // flips from "Segmenting…" to the commit hint once the decode resolves —
    // a deterministic signal we can wait on.
    await waitFor(() => expect(getByTestId('segment-candidate-hint').dataset.state).toBe('ready'));
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(backendTools.propose_mask).toHaveBeenCalledTimes(1));
    const [sessionId, input] = (backendTools.propose_mask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sessionId).toBe('sess-1');
    expect(input.imageNodeId).toBe('in-1');
    expect(input.origin).toBe('client_new');
    expect(typeof input.pngBase64).toBe('string');
    expect(input.pngBase64.length).toBeGreaterThan(0);
  });

  it('shift-click after a candidate appends a refinement point (label 0 if inside mask)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    // 1) plain click to establish a candidate
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    decodeMock.mockClear();
    // 2) shift-click on the same spot — that point falls inside the fake mask's
    //    top-left "on" quadrant, so the new point's label must be 0 (negative).
    fireEvent.click(layer, { clientX: 100, clientY: 75, shiftKey: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeMock).toHaveBeenCalledTimes(1);
    const points = decodeMock.mock.calls[0][0];
    expect(points).toHaveLength(2);
    expect(points[1].label).toBe(0);
  });

  it('Enter after a refinement commits with origin client_refinement', async () => {
    const { findByTestId, getByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await waitFor(() => expect(getByTestId('segment-candidate-hint').dataset.state).toBe('ready'));
    fireEvent.click(layer, { clientX: 100, clientY: 75, shiftKey: true });
    await waitFor(() => expect(decodeMock).toHaveBeenCalledTimes(2));
    // Re-wait for the refinement's mask to settle before pressing Enter.
    await waitFor(() => expect(getByTestId('segment-candidate-hint').dataset.state).toBe('ready'));
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(backendTools.propose_mask).toHaveBeenCalledTimes(1));
    const [, input] = (backendTools.propose_mask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.origin).toBe('client_refinement');
  });

  it('Esc discards the candidate (Enter after Esc does not commit)', async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await waitFor(() => expect(getByTestId('segment-candidate-hint').dataset.state).toBe('ready'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(queryByTestId('segment-candidate-hint')).toBeNull());
    fireEvent.keyDown(window, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(backendTools.propose_mask).not.toHaveBeenCalled();
  });

  it('new plain click while a candidate exists starts a fresh decode (one more call)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    decodeMock.mockClear();
    fireEvent.click(layer, { clientX: 200, clientY: 150 });
    await new Promise((r) => setTimeout(r, 0));
    expect(decodeMock).toHaveBeenCalledTimes(1);
    const points = decodeMock.mock.calls[0][0];
    expect(points).toHaveLength(1);
    expect(points[0].label).toBe(1);
  });
});
