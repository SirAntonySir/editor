// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';

// The real extract bakes pixels through LayerCompositor + OffscreenCanvas,
// neither of which exists here. Stub it to hand back a known layer id; the
// behaviour under test is how the NEW image-node is sized, not the bake.
vi.mock('@/store/segment-actions', () => ({
  extractLayerFromMask: vi.fn(() => 'cut-layer'),
}));

const {
  copyObjectToImageNode,
  copyObjectToLayer,
  selectInvertedObject,
} = await import('./object-actions');
const { extractLayerFromMask } = await import('@/store/segment-actions');

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
    activeObjectId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  maskStore.clear();
  vi.restoreAllMocks();
});

// ─── copyObjectToImageNode ────────────────────────────────────────────────

describe('copyObjectToImageNode', () => {
  it("enters at the source node's on-screen scale, not the default node width", () => {
    const editor = useEditorStore.getState();
    // A 4284×5712 photo the user has shrunk to 400 canvas-units wide.
    const srcId = editor.addImageNode(['srcLayer'], { x: 0, y: 0 }, { w: 4284, h: 5712 });
    editor.setImageNodeDisplayWidth(srcId, 400);

    const maskRef = maskStore.register({
      layerId: 'srcLayer',
      width: 4,
      height: 4,
      data: new Uint8Array(16).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });
    // The baked cutout is 1648×3340 source-pixels (a slice of the photo).
    vi.spyOn(pixelStore, 'getSource').mockReturnValue(
      { width: 1648, height: 3340 } as unknown as OffscreenCanvas,
    );

    copyObjectToImageNode(maskRef, srcId);

    const newNode = Object.values(useEditorStore.getState().imageNodes).find(
      (n) => n.id !== srcId,
    );
    expect(newNode).toBeDefined();
    // Source scale = 400 / 4284. Cutout (1648px) should land at the same scale.
    expect(Math.round(newNode!.size.w)).toBe(Math.round((1648 * 400) / 4284));
    // Regression guard: must not be blown up to the full-node default (600).
    expect(newNode!.size.w).not.toBe(600);
  });

  it('returns the new image-node id and baked layer id', () => {
    const editor = useEditorStore.getState();
    const srcId = editor.addImageNode(['srcLayer'], { x: 0, y: 0 }, { w: 100, h: 100 });
    const maskRef = maskStore.register({
      layerId: 'srcLayer',
      width: 4,
      height: 4,
      data: new Uint8Array(16).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });
    vi.spyOn(pixelStore, 'getSource').mockReturnValue(
      { width: 40, height: 40 } as unknown as OffscreenCanvas,
    );

    const result = copyObjectToImageNode(maskRef, srcId);

    expect(result).not.toBeNull();
    expect(typeof result!.imageNodeId).toBe('string');
    expect(typeof result!.layerId).toBe('string');
    // The new node is set active, so its id matches activeImageNodeId.
    expect(result!.imageNodeId).toBe(useEditorStore.getState().activeImageNodeId);
    // The baked layer becomes the active edit layer.
    expect(useEditorStore.getState().activeLayerId).toBe(result!.layerId);
  });

  it('makes an independent reversible copy — raw pixels + a clone of the source adjustments', () => {
    useBackendState.setState({ sessionId: 'sid' } as never);
    const clone = vi.spyOn(backendTools, 'duplicate_layer_edits').mockResolvedValue({ ok: true } as never);
    const editor = useEditorStore.getState();
    const srcId = editor.addImageNode(['srcLayer'], { x: 0, y: 0 }, { w: 100, h: 100 });
    const maskRef = maskStore.register({
      layerId: 'srcLayer', width: 4, height: 4,
      data: new Uint8Array(16).fill(255), source: 'sam-point', createdAt: 0,
    });
    vi.spyOn(pixelStore, 'getSource').mockReturnValue({ width: 40, height: 40 } as unknown as OffscreenCanvas);

    copyObjectToImageNode(maskRef, srcId);

    // Raw pixels (so cloned adjustments don't double-grade), NOT baked composite.
    expect(extractLayerFromMask).toHaveBeenCalledWith(
      expect.objectContaining({ rawPixels: true }),
    );
    // Adjustments cloned onto the new layer as its own, editable independently.
    expect(clone).toHaveBeenCalledWith('sid', {
      mapping: [{ fromLayerId: 'srcLayer', toLayerId: 'cut-layer' }],
    });
  });
});

// ─── copyObjectToLayer ────────────────────────────────────────────────────

describe('copyObjectToLayer', () => {
  it('bakes a cutout into a new layer on the SAME node and returns its id', () => {
    const editor = useEditorStore.getState();
    const srcId = editor.addImageNode(['srcLayer'], { x: 0, y: 0 }, { w: 100, h: 100 });
    const maskRef = maskStore.register({
      layerId: 'srcLayer',
      width: 4,
      height: 4,
      data: new Uint8Array(16).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });

    const newId = copyObjectToLayer(maskRef, srcId);

    expect(newId).toBe('cut-layer'); // the mocked extractLayerFromMask return
    const node = useEditorStore.getState().imageNodes[srcId];
    expect(node.layerIds).toContain('cut-layer');
    // It must NOT spawn a new image node — the cutout stays in the source node.
    expect(Object.keys(useEditorStore.getState().imageNodes)).toEqual([srcId]);
  });

  it('returns null when the source node does not exist', () => {
    const maskRef = maskStore.register({
      layerId: 'l', width: 2, height: 2, data: new Uint8Array(4).fill(255),
      source: 'sam-point', createdAt: 0,
    });
    expect(copyObjectToLayer(maskRef, 'nope')).toBeNull();
  });

  it('makes an independent reversible copy — raw pixels + a clone of the source adjustments', () => {
    useBackendState.setState({ sessionId: 'sid' } as never);
    const clone = vi.spyOn(backendTools, 'duplicate_layer_edits').mockResolvedValue({ ok: true } as never);
    const editor = useEditorStore.getState();
    const srcId = editor.addImageNode(['srcLayer'], { x: 0, y: 0 }, { w: 100, h: 100 });
    const maskRef = maskStore.register({
      layerId: 'srcLayer', width: 4, height: 4,
      data: new Uint8Array(16).fill(255), source: 'sam-point', createdAt: 0,
    });

    copyObjectToLayer(maskRef, srcId);

    expect(extractLayerFromMask).toHaveBeenCalledWith(
      expect.objectContaining({ rawPixels: true }),
    );
    expect(clone).toHaveBeenCalledWith('sid', {
      mapping: [{ fromLayerId: 'srcLayer', toLayerId: 'cut-layer' }],
    });
  });
});

// ─── selectInvertedObject ────────────────────────────────────────────────────

describe('selectInvertedObject', () => {
  it('dispatches an external candidate event with inverted mask data', () => {
    const ref = maskStore.register({
      layerId: 'L1',
      label: 'Sky',
      width: 2,
      height: 2,
      data: new Uint8Array([0, 64, 128, 255]),
      source: 'sam-point',
      createdAt: 0,
    });

    let captured: CustomEvent<unknown> | null = null;
    const handler = (e: Event) => { captured = e as CustomEvent<unknown>; };
    window.addEventListener('segment-hit:external-candidate', handler);

    selectInvertedObject(ref, 'in-1');

    window.removeEventListener('segment-hit:external-candidate', handler);

    expect(captured).not.toBeNull();
    const detail = (captured as unknown as {
      detail: {
        imageNodeId: string;
        mask: { data: Uint8Array; width: number; height: number };
        label: string;
        origin: string;
      };
    }).detail;
    expect(detail.imageNodeId).toBe('in-1');
    expect(detail.mask.width).toBe(2);
    expect(detail.mask.height).toBe(2);
    expect(Array.from(detail.mask.data)).toEqual([255, 191, 127, 0]);
    expect(detail.label).toMatch(/inverted of sky/i);
    expect(detail.origin).toBe('client_new');
    // No mask was registered client-side — only the original exists.
    expect(maskStore.allForLayer('L1').length).toBe(1);
    // activeObjectId must remain untouched.
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('toasts and dispatches no event if mask is gone', () => {
    let captured: CustomEvent<unknown> | null = null;
    const handler = (e: Event) => { captured = e as CustomEvent<unknown>; };
    window.addEventListener('segment-hit:external-candidate', handler);

    selectInvertedObject('does-not-exist', 'in-1');

    window.removeEventListener('segment-hit:external-candidate', handler);

    expect(captured).toBeNull();
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });
});

// ─── deleteObject / renameObject — session-id resolution ────────────────────
// Regression: both read ONLY useAiSession.sessionId, which is null until the
// user runs AI analyze. The optimistic local update ran (mask vanished from
// the UI) but the backend call silently bailed — so every masksIndex refresh
// brought all "deleted" masks back. Session id must resolve from
// useBackendState first, exactly like materializeCandidate does.

describe('deleteObject / renameObject session resolution', () => {
  it('deleteObject reaches the backend when only useBackendState has a session', async () => {
    const { useBackendState } = await import('@/store/backend-state-slice');
    const { useAiSession } = await import('@/hooks/useImageContext');
    const { backendTools } = await import('@/lib/backend-tools');
    const { deleteObject } = await import('./object-actions');

    useAiSession.setState({ sessionId: null });
    useBackendState.setState({ sessionId: 'tool-sess' });
    const spy = vi.spyOn(backendTools, 'delete_mask')
      .mockResolvedValue({ ok: true, output: { ok: true } } as never);

    await deleteObject('m-1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('tool-sess', { maskId: 'm-1' });
  });

  it('renameObject reaches the backend when only useBackendState has a session', async () => {
    const { useBackendState } = await import('@/store/backend-state-slice');
    const { useAiSession } = await import('@/hooks/useImageContext');
    const { backendTools } = await import('@/lib/backend-tools');
    const { renameObject } = await import('./object-actions');

    useAiSession.setState({ sessionId: null });
    useBackendState.setState({ sessionId: 'tool-sess' });
    const spy = vi.spyOn(backendTools, 'rename_mask')
      .mockResolvedValue({ ok: true, output: { ok: true } } as never);

    await renameObject('m-1', 'sky');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('tool-sess', { maskId: 'm-1', label: 'sky' });
  });
});
