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

const { extractObjectToImageNode } = await import('./object-actions');

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  maskStore.clear();
  vi.restoreAllMocks();
});

describe('extractObjectToImageNode', () => {
  it('enters at the source node’s on-screen scale, not the default node width', () => {
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
