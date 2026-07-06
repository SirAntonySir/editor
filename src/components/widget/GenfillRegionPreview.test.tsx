import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GenfillRegionPreview } from './GenfillRegionPreview';
import { maskStore } from '@/core/mask-store';
import { useEditorStore } from '@/store';
import type { Widget } from '@/types/widget';

vi.mock('@/store/genfill-actions', () => ({
  // Source image is 128x96 px (the mask below is 64x48 → 2x upscale).
  genfillNodeDims: vi.fn(() => ({ width: 128, height: 96 })),
}));
vi.mock('@/lib/genfill-asset', () => ({
  genfillAssetUrl: () => 'http://x/asset.png',
}));

function readyWidget(): Widget {
  return {
    id: 'w_gf_1', intent: 'Generative fill', scope: { kind: 'mask', mask_id: 'm1' },
    origin: { kind: 'tool_invoked' }, composed: false, nodes: [], bindings: [],
    preview: { kind: 'none', autoBeforeAfter: false }, rejectedAttempts: [],
    status: 'active', revision: 1, lockedParams: [],
    createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-03T00:00:00Z',
    genfill: {
      status: 'ready', prompt: 'green shoes', seed: 7, maskId: 'm1',
      imageNodeId: 'in-1',
      result: { assetId: 'genfill-w_gf_1', width: 64, height: 48 },
    },
  } as Widget;
}

beforeEach(() => {
  maskStore.clear();
  // Mask 64x48 with a filled rect: bbox x[16..47], y[12..35].
  const data = new Uint8Array(64 * 48);
  for (let y = 12; y <= 35; y++) {
    for (let x = 16; x <= 47; x++) data[y * 64 + x] = 255;
  }
  maskStore.injectWithId({
    id: 'm1', layerId: 'L1', width: 64, height: 48, data,
    source: 'sam-point', createdAt: 0,
  });
  // Node displayed at HALF source scale: size 64x48 vs sourceSize 128x96.
  useEditorStore.setState({
    imageNodes: {
      'in-1': {
        id: 'in-1', layerIds: ['L1'], position: { x: 0, y: 0 },
        size: { w: 64, h: 48 }, sourceSize: { w: 128, h: 96 },
      },
    },
  } as never);
});

beforeEach(() => {
  // jsdom provides a truthy 2d context stub, so the After-mode effect reaches
  // its fetch — stub it so no real network is attempted.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('GenfillRegionPreview', () => {
  it('crops to the mask bbox (padded) and scales to the node display scale', () => {
    render(<GenfillRegionPreview widget={readyWidget()} sessionId="s1" />);
    const canvas = document.querySelector(
      '[data-testid="genfill-region-preview"] canvas',
    ) as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    // Mask bbox → source px (×2) with 16px pad, clamped:
    //   x = 16*2-16 = 16, y = 12*2-16 = 8, w = 32*2+32 = 96, h = 24*2+32 = 80
    // Backing is then scaled to the node's flow scale (size/sourceSize = 0.5),
    // so it tracks the on-canvas size instead of the full generated resolution:
    //   96*0.5 = 48, 80*0.5 = 40.
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(40);
    // Split-width layout: each canvas fills its half via CSS, keeping the crop
    // aspect ratio (48/40 = 1.2) rather than a fixed display-scaled size.
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.aspectRatio).toBe('1.2');
  });

  it('shows both before and after previews side by side (no toggle)', () => {
    render(<GenfillRegionPreview widget={readyWidget()} sessionId="s1" />);
    const canvases = document.querySelectorAll(
      '[data-testid="genfill-region-preview"] canvas',
    );
    expect(canvases.length).toBe(2);
    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
    // The old mode-toggle buttons are gone.
    expect(screen.queryByRole('button', { name: 'Before' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'After' })).toBeNull();
  });

  it('renders nothing when the mask is gone', () => {
    maskStore.clear();
    const { container } = render(<GenfillRegionPreview widget={readyWidget()} sessionId="s1" />);
    expect(container.querySelector('[data-testid="genfill-region-preview"]')).toBeNull();
  });
});
