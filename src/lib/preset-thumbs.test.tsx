import { describe, it, expect, vi, beforeEach } from 'vitest';

const editor = vi.hoisted(() => ({ pixelVersion: 0 }));
const pixels = vi.hoisted(() => ({
  source: { width: 1920, height: 1080 } as { width: number; height: number } | null,
}));

vi.mock('@/store', () => ({
  useEditorStore: { getState: () => ({ pixelVersion: editor.pixelVersion }) },
}));
vi.mock('@/core/pixel-store', () => ({
  pixelStore: { getSource: () => pixels.source },
}));
vi.mock('@/lib/image-node-renderer', () => ({
  renderImageNodeComposite: vi.fn(),
}));
vi.mock('@/lib/registry/loader', () => ({
  loadRegistry: () => ({
    ops: {
      light: { engine: { node_type: 'basic' } },
      hsl: { engine: { node_type: 'hsl' } },
    },
    presets: {
      warm: {
        id: 'warm',
        display_name: 'Warm',
        description: 'Warm grade',
        category: 'tone',
        ops: [
          { op_id: 'light', params: { exposure: 0.3, contrast: 10 } },
          { op_id: 'hsl', params: { red_hue: 8 } },
          { op_id: 'ghost', params: { x: 1 } }, // no registry op → skipped
        ],
      },
    },
  }),
}));

import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import { buildPresetOptimistic, getPresetThumb, resetPresetThumbCache } from './preset-thumbs';

const renderMock = vi.mocked(renderImageNodeComposite);

beforeEach(() => {
  vi.clearAllMocks();
  resetPresetThumbCache();
  editor.pixelVersion = 0;
  pixels.source = { width: 1920, height: 1080 };
  globalThis.createImageBitmap = vi.fn(async (src) => {
    const s = src as { width: number; height: number };
    return { width: s.width, height: s.height, close: () => {} } as unknown as ImageBitmap;
  }) as unknown as typeof createImageBitmap;
});

describe('buildPresetOptimistic', () => {
  it('keys phantom canon nodes by engine node_type, one binding per param', () => {
    const map = buildPresetOptimistic('warm', 'L1');
    expect([...map.keys()].sort()).toEqual(['canon:L1:basic', 'canon:L1:hsl']);
    expect(map.get('canon:L1:basic')!.bindings).toEqual([
      { paramKey: 'exposure', value: 0.3 },
      { paramKey: 'contrast', value: 10 },
    ]);
    expect(map.get('canon:L1:hsl')!.bindings).toEqual([{ paramKey: 'red_hue', value: 8 }]);
  });

  it('skips ops with no registry entry and unknown presets', () => {
    const map = buildPresetOptimistic('warm', 'L1');
    expect([...map.keys()].some((k) => k.includes('ghost'))).toBe(false);
    expect(buildPresetOptimistic('nope', 'L1').size).toBe(0);
  });
});

describe('getPresetThumb', () => {
  it('renders original pixels + preset via the pipeline with a namespaced node id', async () => {
    const bmp = await getPresetThumb('warm', 'L1');
    expect(bmp).not.toBeNull();
    expect(renderMock).toHaveBeenCalledTimes(1);
    const args = renderMock.mock.calls[0][0];
    expect(args.imageNodeId).toBe('preset-thumb:warm');
    expect(args.opGraph).toBeUndefined(); // original pixels — no current edits
    expect(args.layerIds).toEqual(['L1']);
    expect(args.bakePerLayerOnly).toBe(true);
    expect(args.skipOverlays).toBe(true);
    expect(args.optimistic!.get('canon:L1:basic')).toBeTruthy();
    // 1920×1080 → long edge 96 ⇒ scale 0.05, canvas 96×54
    expect(args.renderScale).toBeCloseTo(0.05);
    expect(args.canvas.width).toBe(96);
    expect(args.canvas.height).toBe(54);
  });

  it('caches by preset — a second call does not re-render', async () => {
    const a = await getPresetThumb('warm', 'L1');
    const b = await getPresetThumb('warm', 'L1');
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it('flushes the cache when pixelVersion changes', async () => {
    await getPresetThumb('warm', 'L1');
    editor.pixelVersion = 1;
    await getPresetThumb('warm', 'L1');
    expect(renderMock).toHaveBeenCalledTimes(2);
  });

  it('flushes the cache when the layer changes', async () => {
    await getPresetThumb('warm', 'L1');
    await getPresetThumb('warm', 'L2');
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(renderMock.mock.calls[1][0].layerIds).toEqual(['L2']);
  });

  it('returns null without rendering when the layer has no source pixels', async () => {
    pixels.source = null;
    expect(await getPresetThumb('warm', 'L1')).toBeNull();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('returns null when the pipeline throws', async () => {
    renderMock.mockImplementation(() => {
      throw new Error('gl fail');
    });
    expect(await getPresetThumb('warm', 'L1')).toBeNull();
  });
});
