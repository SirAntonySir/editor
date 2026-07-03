import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import { putSource, __resetForTests } from './pixel-source-store';
import { restorePixelSources } from './restore-pixel-sources';
import type { Layer } from '@/store/layer-slice';

function layer(id: string, type: Layer['type'] = 'image'): Layer {
  return {
    id,
    type,
    name: `layer-${id}`,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    order: 0,
  };
}

function pngBlob(): Blob {
  // 1x1 transparent PNG
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return new Blob([bytes], { type: 'image/png' });
}

describe('restorePixelSources', () => {
  beforeEach(async () => {
    await __resetForTests();
    pixelStore.clear();
    useEditorStore.setState({ layers: [], activeLayerId: null });
  });

  it('seeds pixelStore for every image layer that has a stored blob', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    // Stub createImageBitmap — the test runs in node, which doesn't ship it.
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1,
      height: 1,
      close: () => {},
    } as unknown as ImageBitmap)));
    // Stub OffscreenCanvas — same reason.
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l1', pngBlob());
    await putSource('s1', 'l2', pngBlob());
    useEditorStore.setState({ layers: [layer('l1'), layer('l2')] });

    await restorePixelSources('s1');

    expect(registerSpy).toHaveBeenCalledTimes(2);
    expect(registerSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['l1', 'l2']);

    vi.unstubAllGlobals();
  });

  it('restores non-image layers that have a stored blob (genfill, extracted cutouts)', async () => {
    // Regression: runtime-created pixel layers persist sources under their own
    // type ('genfill', …). The restorer used to skip everything except 'image',
    // so those layers came back empty after reload.
    const registerSpy = vi.spyOn(pixelStore, 'register');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} } as unknown as ImageBitmap)));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'g1', pngBlob());
    useEditorStore.setState({
      layers: [layer('g1', 'genfill' as Layer['type']), layer('a1', 'adjustment' as Layer['type'])],
    });

    await restorePixelSources('s1');

    // g1 has a blob → restored; a1 has none → silently skipped.
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toBe('g1');

    vi.unstubAllGlobals();
  });

  it('skips layers with no stored blob and continues with the rest', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: () => {} } as unknown as ImageBitmap)));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l2', pngBlob());
    useEditorStore.setState({ layers: [layer('l1'), layer('l2')] });

    await restorePixelSources('s1');

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toBe('l2');

    vi.unstubAllGlobals();
  });

  it('continues when a single blob fails to decode', async () => {
    const registerSpy = vi.spyOn(pixelStore, 'register');
    // First call throws, second succeeds.
    let n = 0;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('decode failed');
      return { width: 1, height: 1, close: () => {} } as unknown as ImageBitmap;
    }));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
    });

    await putSource('s1', 'l1', pngBlob());
    await putSource('s1', 'l2', pngBlob());
    useEditorStore.setState({ layers: [layer('l1'), layer('l2')] });

    await restorePixelSources('s1');

    expect(registerSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
