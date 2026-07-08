/**
 * duplicate-image-node — name derivation only.
 *
 * The full duplicate flow round-trips OffscreenCanvas → blob → File →
 * addImage, which depends on a live document, pixelStore, and
 * IndexedDB; that's covered by integration paths. Here we just lock the
 * "copy" name semantics so the Layer-tab labels read cleanly across
 * repeated duplicates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// duplicate-image-node now imports duplicateLayer from segment-actions, which
// transitively loads the WebGL layer-compositor (needs a real canvas). Stub it
// so this pure name-derivation test collects in the node environment.
vi.mock('@/store/segment-actions', () => ({ duplicateLayer: vi.fn() }));

const { deriveDuplicateName, duplicateImageNode } = await import('./duplicate-image-node');
const { duplicateLayer } = await import('@/store/segment-actions');
const { useEditorStore } = await import('@/store');

const IMG = (id: string) => ({
  id, type: 'image', name: id,
  visible: true, opacity: 1, blendMode: 'normal' as const, locked: false,
});

describe('deriveDuplicateName', () => {
  it('inserts " copy" before the extension on the first duplicate', () => {
    expect(deriveDuplicateName('photo.jpg')).toBe('photo copy.jpg');
  });

  it('appends a counter on subsequent duplicates of an already-copied name', () => {
    expect(deriveDuplicateName('photo copy.jpg')).toBe('photo copy 2.jpg');
    expect(deriveDuplicateName('photo copy 2.jpg')).toBe('photo copy 3.jpg');
    expect(deriveDuplicateName('photo copy 9.jpg')).toBe('photo copy 10.jpg');
  });

  it('handles names without an extension', () => {
    expect(deriveDuplicateName('untitled')).toBe('untitled copy');
    expect(deriveDuplicateName('untitled copy')).toBe('untitled copy 2');
  });

  it('treats a leading dot as part of the stem (hidden file)', () => {
    // `.env` has no extension by the lastIndexOf rule (dot at index 0,
    // which the impl excludes via `dot > 0`). Behaves like a stem-only.
    expect(deriveDuplicateName('.env')).toBe('.env copy');
  });

  it('does not collide a literal " copy" anywhere mid-name with the counter', () => {
    // "my copy of last year.png" — the regex anchors to the END so the
    // mid-name "copy" stays as part of the stem.
    expect(deriveDuplicateName('my copy of last year.png'))
      .toBe('my copy of last year copy.png');
  });
});

describe('duplicateImageNode selection', () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: [],
      activeLayerId: null,
      imageNodes: {},
      activeImageNodeId: null,
    } as unknown as Parameters<typeof useEditorStore.setState>[0]);
    // Stand in for the real (canvas-bound) duplicateLayer: add a fresh layer
    // record and hand back its id, mirroring the fields duplicateImageNode
    // needs without touching OffscreenCanvas.
    let seq = 0;
    (duplicateLayer as unknown as ReturnType<typeof vi.fn>).mockImplementation((srcId: string) => {
      const id = `${srcId}-copy-${seq++}`;
      useEditorStore.getState().addLayer(IMG(id));
      return id;
    });
  });

  it('adopts the copy as active so the active layer belongs to the active image node', () => {
    const s = useEditorStore.getState();
    s.addLayer(IMG('LA'));
    const nodeA = s.addImageNode(['LA'], { x: 0, y: 0 }, { w: 10, h: 10 });
    useEditorStore.getState().setActiveImageNode(nodeA);
    useEditorStore.getState().setActiveLayer('LA');

    const newNodeId = duplicateImageNode(nodeA);
    expect(newNodeId).toBeTruthy();

    const after = useEditorStore.getState();
    // The copy — not the original — is now the active image node...
    expect(after.activeImageNodeId).toBe(newNodeId);
    // ...and the active layer lives inside it (the invariant the inspector
    // preview and the canvas both depend on).
    expect(after.imageNodes[after.activeImageNodeId!].layerIds).toContain(after.activeLayerId);
  });
});
