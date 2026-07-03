import { describe, it, expect, beforeEach, vi } from 'vitest';
import { maskStore } from '@/core/mask-store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { SessionStateSnapshot, Widget, GenfillState } from '@/types/widget';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    accept_widget: vi.fn(async () => ({ ok: true, output: { widgetId: 'w_gf_1' } })),
    delete_widget: vi.fn(async () => ({ ok: true, output: { widgetId: 'w_gf_1' } })),
  },
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { info: vi.fn() } }));

const { acceptGenfill, discardGenfill, __clipCanvasWithMask } = await import('./genfill-actions');

function makeGenfillWidget(g: Partial<GenfillState>): Widget {
  return {
    id: 'w_gf_1', intent: 'Generative fill', scope: { kind: 'mask', mask_id: 'm1' },
    origin: { kind: 'tool_invoked' }, composed: false, nodes: [], bindings: [],
    preview: { kind: 'none', autoBeforeAfter: false }, rejectedAttempts: [],
    status: 'active', revision: 1, lockedParams: [],
    createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
    genfill: {
      status: 'ready', prompt: 'a boat', seed: 7, maskId: 'm1',
      imageNodeId: 'in-default', ...g,
    },
  } as Widget;
}

function seedSnapshot(widget: Widget): void {
  const snapshot = {
    sessionId: 's1', imageContext: null, widgets: [widget], masksIndex: [],
    operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
    revision: 1,
  } as unknown as SessionStateSnapshot;
  useBackendState.setState({ snapshot });
}

beforeEach(() => {
  vi.clearAllMocks();
  useBackendState.getState().reset();
  maskStore.clear();
});

describe('acceptGenfill guards (no canvas needed)', () => {
  it('returns null when the widget is not ready', async () => {
    seedSnapshot(makeGenfillWidget({ status: 'generating' }));
    expect(await acceptGenfill('w_gf_1', { clip: true })).toBeNull();
  });

  it('returns null when the widget is missing', async () => {
    seedSnapshot(makeGenfillWidget({ status: 'ready', result: { assetId: 'a', width: 2, height: 1 } }));
    expect(await acceptGenfill('nope', { clip: true })).toBeNull();
  });

  it('returns null when there is no result yet', async () => {
    seedSnapshot(makeGenfillWidget({ status: 'ready', result: null }));
    expect(await acceptGenfill('w_gf_1', { clip: true })).toBeNull();
  });
});

describe('discardGenfill', () => {
  it('calls delete_widget with suppressSimilar=false', async () => {
    seedSnapshot(makeGenfillWidget({}));
    await discardGenfill('w_gf_1');
    expect(backendTools.delete_widget).toHaveBeenCalledWith('s1', {
      widgetId: 'w_gf_1',
      suppressSimilar: false,
    });
  });

  it('no-ops without a session', async () => {
    await discardGenfill('w_gf_1');
    expect(backendTools.delete_widget).not.toHaveBeenCalled();
  });
});

// __clipCanvasWithMask relies on OffscreenCanvas, which is absent in the Node
// test environment (same constraint segment-actions.test.ts documents). Guard
// so the assertion runs where the API exists and is skipped otherwise.
describe.skipIf(typeof OffscreenCanvas === 'undefined')('__clipCanvasWithMask', () => {
  it('zeroes alpha outside the mask and keeps it inside', () => {
    const canvas = new OffscreenCanvas(2, 1);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 1);
    __clipCanvasWithMask(canvas, { width: 2, height: 1, data: new Uint8Array([255, 0]) });
    const out = ctx.getImageData(0, 0, 2, 1).data;
    expect(out[3]).toBe(255);  // left alpha kept
    expect(out[7]).toBe(0);    // right alpha cleared
  });
});
