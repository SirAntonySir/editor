import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock CanvasRegistry + PipelineManager BEFORE importing the renderer so the
// renderer picks up the stubs. jsdom has a basic 2d context but no WebGL.
// Use `vi.hoisted` so the spies/fakes survive the hoist that `vi.mock` does.
const { canvasRegistryGet, pipelineSetSourceCanvas, pipelineRenderSync } = vi.hoisted(() => ({
  canvasRegistryGet: vi.fn<(id: string) => OffscreenCanvas | undefined>(),
  pipelineSetSourceCanvas: vi.fn<(c: HTMLCanvasElement | OffscreenCanvas) => void>(),
  pipelineRenderSync: vi.fn<(adjs: unknown[]) => HTMLCanvasElement>(),
}));

// jsdom's drawImage rejects POJOs — back the registry and pipeline with real
// HTMLCanvasElements (typed loosely; they share enough surface to pass).
function makeFakeOffscreen(): OffscreenCanvas {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  return c as unknown as OffscreenCanvas;
}
function makeFakeRendered(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  return c;
}

vi.mock('@/lib/canvas-registry', () => ({
  CanvasRegistry: { get: canvasRegistryGet },
}));
vi.mock('@/lib/pipeline-manager', () => ({
  PipelineManager: {
    setSourceCanvas: pipelineSetSourceCanvas,
    renderSync: pipelineRenderSync,
  },
}));

import { renderImageNodeComposite } from './image-node-renderer';
import { useEditorStore } from '@/store';

interface MockLayer {
  id: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  order: number;
}

function setLayers(layers: MockLayer[]): void {
  useEditorStore.setState({ layers } as unknown as Parameters<typeof useEditorStore.setState>[0]);
}

let fakeWorking: OffscreenCanvas;
let fakeRendered: HTMLCanvasElement;

beforeEach(() => {
  fakeWorking = makeFakeOffscreen();
  fakeRendered = makeFakeRendered();
  canvasRegistryGet.mockReset();
  canvasRegistryGet.mockImplementation(() => fakeWorking);
  pipelineSetSourceCanvas.mockReset();
  pipelineRenderSync.mockReset();
  pipelineRenderSync.mockImplementation(() => fakeRendered);
});

describe('renderImageNodeComposite', () => {
  function makeCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    return c;
  }

  it('clears the target canvas and paints each visible layer', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 0.5, blendMode: 'multiply', order: 1 },
    ]);
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context from jsdom');
    const clearSpy = vi.spyOn(ctx, 'clearRect');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      opGraph: undefined,
      widgets: [],
    });

    expect(clearSpy).toHaveBeenCalledWith(0, 0, 8, 8);
    // No adjustments → no pipeline call.
    expect(pipelineRenderSync).not.toHaveBeenCalled();
    // Both layers painted onto the target canvas.
    expect(drawSpy).toHaveBeenCalledTimes(2);
  });

  it('runs the WebGL pipeline for layers that have adjustments', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n1',
            type: 'basic',
            params: { exposure: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layer_id: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
    });

    expect(pipelineSetSourceCanvas).toHaveBeenCalledWith(fakeWorking);
    expect(pipelineRenderSync).toHaveBeenCalledTimes(1);
    const firstCall = pipelineRenderSync.mock.calls[0];
    const adjustments = firstCall[0] as unknown as { type: string }[];
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].type).toBe('basic');
  });

  it('skips hidden layers and layers without source pixels', () => {
    setLayers([
      { id: 'L1', visible: false, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    canvasRegistryGet.mockImplementation((id: string) =>
      id === 'L2' ? fakeWorking : undefined,
    );
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context from jsdom');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      opGraph: undefined,
      widgets: [],
    });

    // L1 hidden, L2 painted exactly once.
    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no layer ids are provided', () => {
    setLayers([]);
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context from jsdom');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: [],
      opGraph: undefined,
      widgets: [],
    });

    expect(drawSpy).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });
});
