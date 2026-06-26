// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';

// The real extract bakes pixels through LayerCompositor + OffscreenCanvas,
// neither of which exists here. Stub it to hand back a known layer id; the
// behaviour under test is how the NEW image-node is sized, not the bake.
vi.mock('@/store/segment-actions', () => ({
  extractLayerFromMask: vi.fn(() => 'cut-layer'),
  duplicateLayer: vi.fn(),
}));

const {
  extractObjectToImageNode,
  selectInvertedObject,
  convertObjectToLayerMask,
} = await import('./object-actions');

// Pull the mocked module so individual tests can configure return values.
const { duplicateLayer } = await import('@/store/segment-actions');

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

// ─── extractObjectToImageNode ────────────────────────────────────────────────

describe('extractObjectToImageNode', () => {
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

    extractObjectToImageNode(maskRef, srcId);

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

    const result = extractObjectToImageNode(maskRef, srcId);

    expect(result).not.toBeNull();
    expect(typeof result!.imageNodeId).toBe('string');
    expect(typeof result!.layerId).toBe('string');
    // The new node is set active, so its id matches activeImageNodeId.
    expect(result!.imageNodeId).toBe(useEditorStore.getState().activeImageNodeId);
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

// ─── convertObjectToLayerMask ────────────────────────────────────────────────

describe('convertObjectToLayerMask', () => {
  it('duplicates the source layer and masks the duplicate, leaving the original untouched', () => {
    const editor = useEditorStore.getState();
    // Seed: image-node 'in-1' with layerIds = ['L1'].
    const nodeId = editor.addImageNode(['L1'], { x: 0, y: 0 }, { w: 100, h: 100 });
    // Add the layer to the store so isRealLayer check passes.
    editor.addLayer({
      id: 'L1',
      type: 'image',
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });

    // duplicateLayer mock should return the new layer id and actually add it.
    const dupId = 'L1_dup';
    vi.mocked(duplicateLayer).mockImplementation(() => {
      editor.addLayer({
        id: dupId,
        type: 'image',
        name: 'Background copy',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
      });
      return dupId;
    });

    const maskRef = maskStore.register({
      layerId: 'L1',
      label: 'Subject',
      width: 2,
      height: 2,
      data: new Uint8Array(4).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });

    convertObjectToLayerMask(maskRef, nodeId);

    const state = useEditorStore.getState();

    // Original L1 must have no layerMask.
    const original = state.layers.find((l) => l.id === 'L1');
    expect(original?.layerMask).toBeUndefined();

    // Duplicate must have the mask applied.
    const dup = state.layers.find((l) => l.id === dupId);
    expect(dup?.layerMask).toBe(maskRef);

    // Image-node must include the new layer.
    expect(state.imageNodes[nodeId].layerIds).toContain(dupId);
  });

  it('is a no-op if duplicateLayer fails', () => {
    const editor = useEditorStore.getState();
    const nodeId = editor.addImageNode(['L1'], { x: 0, y: 0 }, { w: 100, h: 100 });
    editor.addLayer({
      id: 'L1',
      type: 'image',
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });

    vi.mocked(duplicateLayer).mockReturnValue(null);

    const maskRef = maskStore.register({
      layerId: 'L1',
      width: 2,
      height: 2,
      data: new Uint8Array(4).fill(255),
      source: 'sam-point',
      createdAt: 0,
    });

    convertObjectToLayerMask(maskRef, nodeId);

    // Original layer must remain untouched.
    const original = useEditorStore.getState().layers.find((l) => l.id === 'L1');
    expect(original?.layerMask).toBeUndefined();
    // Node should still have only L1.
    expect(useEditorStore.getState().imageNodes[nodeId].layerIds).toEqual(['L1']);
  });
});
