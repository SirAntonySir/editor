import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render as rtlRender, fireEvent, waitFor, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { SegmentHitLayer } from './SegmentHitLayer';

// SegmentHitLayer uses useSegmentExtractDrag → useReactFlow, so renders need a
// provider (matches the app, where it lives inside <ReactFlow>).
const render = (ui: React.ReactElement) => rtlRender(<ReactFlowProvider>{ui}</ReactFlowProvider>);
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
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
    // commitCandidate now reads sessionId from useBackendState (the
    // tool-session store, reliable across reloads). Mirror it here so the
    // existing assertions on propose_mask's session arg still hold.
    useBackendState.setState({ sessionId: 'sess-1' });
  });

  it('plain click calls decode with one positive point', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
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

  it('Enter does not commit — the save step is removed', async () => {
    const { findByTestId, getByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    // Wait for the candidate to settle to mask-resolved state. The footer text
    // flips from "Segmenting…" to the action hint once the decode resolves —
    // a deterministic signal we can wait on.
    await waitFor(() => expect(getByTestId('segment-candidate-hint').dataset.state).toBe('ready'));
    fireEvent.keyDown(window, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    // Committing now happens only via an explicit action verb, never Enter.
    expect(backendTools.propose_mask).not.toHaveBeenCalled();
  });

  it('the candidate hint advertises actions, not save/cancel', async () => {
    const { findByTestId, getByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await waitFor(() => expect(getByTestId('segment-candidate-hint').dataset.state).toBe('ready'));
    const hint = getByTestId('segment-candidate-hint').textContent ?? '';
    expect(hint.toLowerCase()).toContain('refine');
    expect(hint.toLowerCase()).toContain('actions');
    expect(hint.toLowerCase()).not.toContain('save');
  });

  it('shift-click after a candidate appends a refinement point (label 0 if inside mask)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
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

  it('Esc discards the candidate (Enter after Esc does not commit)', async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
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

  it('right-click on the candidate does NOT bubble to the image-node context menu', async () => {
    // Regression: SegmentHitLayer sits INSIDE the image-node's
    // ContextMenu.Trigger. Right-clicking the live selection re-dispatches a
    // bubbling contextmenu event onto the hidden candidate trigger — if that
    // synthetic event escapes the hit layer, the image node's menu opens ON
    // TOP of the candidate menu and swallows the first click.
    const outerContextMenu = vi.fn();
    const { findByTestId } = render(
      <div onContextMenu={outerContextMenu}>
        <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />
      </div>,
    );
    const layer = await findByTestId('segment-hit-layer');
    stubRect(layer);
    // Establish a candidate (fake mask: top-left quadrant on).
    fireEvent.click(layer, { clientX: 100, clientY: 75 });
    await waitFor(() => expect(layer.querySelector('[data-candidate-trigger]')).not.toBeNull());
    // Right-click inside the candidate mask (0.25, 0.25 → top-left quadrant).
    fireEvent.contextMenu(layer, { clientX: 100, clientY: 75 });
    await new Promise((r) => setTimeout(r, 0));
    // Neither the original event (stopPropagation'd by handleContextMenu) nor
    // the re-dispatched one (guard must stop it too) may reach the parent.
    expect(outerContextMenu).not.toHaveBeenCalled();
  });

  it('pressing a candidate-menu item does not start a lasso through the portal', async () => {
    // React portals propagate events through the REACT tree, not the DOM
    // tree: the menu content is a React child of the hit layer, so its
    // pointerdown re-enters handlePointerDown — and in lasso mode that
    // started a freehand draw THROUGH the open menu (hint flipped to
    // "release to close", crosshair, path drawn under the menu).
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => {};
    }
    useEditorStore.getState().setObjectSelectTool('lasso');
    try {
      const { findByTestId, queryByTestId } = render(
        <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
      );
      const layer = await findByTestId('segment-hit-layer');
      stubRect(layer);
      // Inject a candidate without SAM.
      fireEvent(window, new CustomEvent('segment-hit:external-candidate', {
        detail: { imageNodeId: 'in-1', mask: fakeMask(), origin: 'client_lasso' },
      }));
      await waitFor(() => expect(layer.querySelector('[data-candidate-trigger]')).not.toBeNull());
      // Open the candidate menu via the re-dispatch path.
      fireEvent.contextMenu(layer, { clientX: 100, clientY: 75 });
      const item = await screen.findByText('Extract to new layer');
      // Left-press the menu item — must NOT arm a lasso draw.
      fireEvent.pointerDown(item, { button: 0, clientX: 620, clientY: 200, pointerId: 1 });
      expect(queryByTestId('lasso-draft-hint')).toBeNull();
    } finally {
      useEditorStore.getState().setObjectSelectTool('point');
    }
  });

  it('new plain click while a candidate exists starts a fresh decode (one more call)', async () => {
    const { findByTestId } = render(
      <SegmentHitLayer imageNodeId="in-1" widthPx={400} heightPx={300} objectsMode={true} />,
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
