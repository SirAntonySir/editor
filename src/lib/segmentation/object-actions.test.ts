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
});

// ─── selectInvertedObject ────────────────────────────────────────────────────

describe('selectInvertedObject', () => {
  it('registers a new mask with per-pixel inverse alpha and selects it', () => {
    const ref = maskStore.register({
      layerId: 'L1',
      width: 2,
      height: 2,
      data: new Uint8Array([0, 64, 128, 255]),
      source: 'sam-point',
      createdAt: 0,
    });

    selectInvertedObject(ref);

    const newId = useEditorStore.getState().activeObjectId;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(ref);
    const inverted = maskStore.get(newId!);
    expect(inverted).toBeTruthy();
    expect(Array.from(inverted!.data)).toEqual([255, 191, 127, 0]);
    expect(inverted!.layerId).toBe('L1');
    expect(inverted!.label).toMatch(/inverted/i);
  });

  it('preserves label when mask has one', () => {
    const ref = maskStore.register({
      layerId: 'L1',
      label: 'sky',
      width: 1,
      height: 1,
      data: new Uint8Array([100]),
      source: 'sam-point',
      createdAt: 0,
    });

    selectInvertedObject(ref);

    const newId = useEditorStore.getState().activeObjectId;
    const inverted = maskStore.get(newId!);
    expect(inverted!.label).toBe('sky (inverted)');
  });

  it('toasts and no-ops if mask is gone', () => {
    // activeObjectId starts null (beforeEach resets workspace).
    selectInvertedObject('does-not-exist');
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
