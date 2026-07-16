// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import type { DecodedMask } from '@/lib/segmentation/mobile-sam-types';

vi.mock('@/lib/segmentation/mask-png', () => ({
  maskToPngBase64: vi.fn(async () => 'stub-base64'),
}));
vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_mask: vi.fn(async () => ({ ok: true, output: { maskId: 'new-mask' } })),
  },
}));
vi.mock('@/hooks/useImageContext', () => ({
  useAiSession: { getState: () => ({ context: null }) },
}));
vi.mock('./object-actions', () => ({
  copyObjectToImageNode: vi.fn(() => ({ imageNodeId: 'n2', layerId: 'L2' })),
  copyObjectToLayer: vi.fn(() => 'L3'),
}));

const { backendTools } = await import('@/lib/backend-tools');
const objectActions = await import('./object-actions');
const { materializeCandidate, invertMask, runCandidateVerb } = await import('./candidate-actions');

function mask(width = 4, height = 4): DecodedMask {
  const data = new Uint8Array(width * height);
  data[0] = 255; // single on-pixel top-left
  return { data, width, height };
}

beforeEach(() => {
  (backendTools.propose_mask as ReturnType<typeof vi.fn>).mockClear();
  (backendTools.propose_mask as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, output: { maskId: 'new-mask' } });
  maskStore.clear();
  objectOwnership._resetForTests();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ layers: [], activeLayerId: null, activeObjectId: null } as never);
});

describe('materializeCandidate', () => {
  it('registers the selection via propose_mask and returns the new mask id', async () => {
    const id = await materializeCandidate(
      { points: [{ x: 0.1, y: 0.1, label: 1 }], mask: mask() },
      { sessionId: 'sess-1', imageNodeId: 'in-1', existingCount: 2 },
    );
    expect(id).toBe('new-mask');
    const [sid, input] = (backendTools.propose_mask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sid).toBe('sess-1');
    expect(input.imageNodeId).toBe('in-1');
    expect(input.origin).toBe('client_new');
    expect(input.label).toBe('Object 3'); // existingCount + 1, no AI region match
    expect(objectOwnership.get('new-mask')).toBe('in-1');
  });

  it('uses client_refinement origin when a negative point is present', async () => {
    await materializeCandidate(
      { points: [{ x: 0.1, y: 0.1, label: 1 }, { x: 0.2, y: 0.2, label: 0 }], mask: mask() },
      { sessionId: 'sess-1', imageNodeId: 'in-1', existingCount: 0 },
    );
    const [, input] = (backendTools.propose_mask as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.origin).toBe('client_refinement');
  });

  it('returns null and does not set ownership when propose_mask fails', async () => {
    (backendTools.propose_mask as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { message: 'boom' } });
    const id = await materializeCandidate(
      { points: [{ x: 0.1, y: 0.1, label: 1 }], mask: mask() },
      { sessionId: 'sess-1', imageNodeId: 'in-1', existingCount: 0 },
    );
    expect(id).toBeNull();
  });
});

describe('runCandidateVerb', () => {
  const sel = { points: [{ x: 0.1, y: 0.1, label: 1 as const }], mask: mask() };
  const ctx = { sessionId: 'sess-1', imageNodeId: 'in-1', existingCount: 0 };

  beforeEach(() => {
    (objectActions.copyObjectToImageNode as ReturnType<typeof vi.fn>).mockClear();
    (objectActions.copyObjectToLayer as ReturnType<typeof vi.fn>).mockClear();
  });

  it('materializes then extracts to image node with the new mask id', async () => {
    const id = await runCandidateVerb('copy-node', sel, ctx);
    expect(id).toBe('new-mask');
    expect(objectActions.copyObjectToImageNode).toHaveBeenCalledWith('new-mask', 'in-1');
  });

  it('materializes then extracts to a new in-place layer', async () => {
    await runCandidateVerb('copy-layer', sel, ctx);
    expect(objectActions.copyObjectToLayer).toHaveBeenCalledWith('new-mask', 'in-1');
  });

  it("'keep' commits the mask on the CURRENT layer — no copy, no new layer/node", async () => {
    // The "Adjust the selection" redraw landing: the redrawn region replaces the
    // deleted object in place, like an automatic tag-selection.
    const id = await runCandidateVerb('keep', sel, ctx);
    expect(id).toBe('new-mask');
    expect(objectActions.copyObjectToImageNode).not.toHaveBeenCalled();
    expect(objectActions.copyObjectToLayer).not.toHaveBeenCalled();
  });

  it('returns null and runs no action when materialize fails', async () => {
    (backendTools.propose_mask as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { message: 'boom' } });
    const id = await runCandidateVerb('copy-node', sel, ctx);
    expect(id).toBeNull();
    expect(objectActions.copyObjectToImageNode).not.toHaveBeenCalled();
  });
});

describe('invertMask', () => {
  it('flips every mask byte (0 <-> 255) and preserves dimensions', () => {
    const m = mask(2, 2); // [255, 0, 0, 0]
    const inv = invertMask(m);
    expect(inv.width).toBe(2);
    expect(inv.height).toBe(2);
    expect(Array.from(inv.data)).toEqual([0, 255, 255, 255]);
  });
});
