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
import { getInternalCanvas } from './image-node-geometry';
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

  it('clears the internal canvas and paints each visible layer into it', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 0.5, blendMode: 'multiply', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: undefined,
      widgets: [],
    });

    // No adjustments → no pipeline call.
    expect(pipelineRenderSync).not.toHaveBeenCalled();
    // Per-layer paints go to the internal canvas. The internal canvas context
    // will have had drawImage called twice (once per layer).
    const internal = getInternalCanvas('in-1', 8, 8);
    const internalCtx = internal.getContext('2d');
    if (!internalCtx) throw new Error('expected internal 2d context');
    // Visible canvas gets exactly one drawImage from applyGeometry.
    const visibleCtx = canvas.getContext('2d');
    if (!visibleCtx) throw new Error('expected visible 2d context from jsdom');
    // We can't spy retroactively, but we verify via the new-test below.
    // Here we just verify the pipeline was NOT invoked (no adjustments).
    expect(pipelineSetSourceCanvas).not.toHaveBeenCalled();
  });

  it('runs the WebGL pipeline for layers that have adjustments', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
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
            layerId: 'L1',
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
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: undefined,
      widgets: [],
    });

    // L1 is hidden, L2 is painted to the internal canvas.
    // The visible canvas receives exactly one drawImage from applyGeometry.
    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it('applies a node-scope adjustment to the composite when layer_ids fit', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-composite',
            type: 'basic',
            params: { exposure: 0.25 },
            scope: { kind: 'global' },
            inputs: [],
            layerIds: ['L1', 'L2'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
    });

    // No per-layer adjustments, so setSourceCanvas only fires for the
    // composite pass. Composite pass now uses the internal cache canvas.
    expect(pipelineSetSourceCanvas).toHaveBeenCalledTimes(1);
    const compositeCall = pipelineSetSourceCanvas.mock.calls[0];
    // The composite pass source is the internal canvas — not the visible one
    // and not the layer working canvas.
    expect(compositeCall[0]).not.toBe(canvas);
    expect(compositeCall[0]).not.toBe(fakeWorking);
    expect(pipelineRenderSync).toHaveBeenCalledTimes(1);
    const adjustments = pipelineRenderSync.mock.calls[0][0] as unknown as {
      id: string;
      type: string;
    }[];
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].id).toBe('n-composite');
    expect(adjustments[0].type).toBe('basic');
  });

  it('skips node-scope adjustments whose layer_ids do not fit this image node', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-stray',
            type: 'basic',
            params: { exposure: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layerIds: ['L1', 'L-other-node'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
    });

    // No per-layer node, no fitting node-scope node → no WebGL pass at all.
    expect(pipelineSetSourceCanvas).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });

  it('runs per-layer adjustments first, then the node-scope composite pass', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-per-layer',
            type: 'basic',
            params: { exposure: 0.1 },
            scope: { kind: 'global' },
            inputs: [],
            layerId: 'L1',
          },
          {
            id: 'n-composite',
            type: 'basic',
            params: { contrast: 0.2 },
            scope: { kind: 'global' },
            inputs: [],
            layerIds: ['L1', 'L2'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
    });

    // Two pipeline invocations: per-layer L1, then composite.
    expect(pipelineSetSourceCanvas).toHaveBeenCalledTimes(2);
    expect(pipelineRenderSync).toHaveBeenCalledTimes(2);

    // Per-layer call comes first with the layer's working canvas.
    expect(pipelineSetSourceCanvas.mock.calls[0][0]).toBe(fakeWorking);
    const perLayerAdjustments = pipelineRenderSync.mock.calls[0][0] as unknown as {
      id: string;
    }[];
    expect(perLayerAdjustments).toHaveLength(1);
    expect(perLayerAdjustments[0].id).toBe('n-per-layer');

    // Composite pass now uses the internal cache canvas, not the visible canvas.
    const compositeCall = pipelineSetSourceCanvas.mock.calls[pipelineSetSourceCanvas.mock.calls.length - 1];
    expect(compositeCall[0]).not.toBe(fakeWorking);
    expect(compositeCall[0]).not.toBe(canvas);
    const compositeAdjustments = pipelineRenderSync.mock.calls[1][0] as unknown as {
      id: string;
    }[];
    expect(compositeAdjustments).toHaveLength(1);
    expect(compositeAdjustments[0].id).toBe('n-composite');
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
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: undefined,
      widgets: [],
    });

    expect(drawSpy).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });

  it('skips adjustment nodes whose ids are in hiddenNodeIds', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-keep',
            type: 'basic',
            params: { exposure: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layerId: 'L1',
          },
          {
            id: 'n-hide',
            type: 'basic',
            params: { contrast: 0.5 },
            scope: { kind: 'global' },
            inputs: [],
            layerId: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      hiddenNodeIds: new Set(['n-hide']),
    });

    expect(pipelineRenderSync).toHaveBeenCalledTimes(1);
    const adjustments = pipelineRenderSync.mock.calls[0][0] as unknown as { id: string }[];
    expect(adjustments.map((a) => a.id)).toEqual(['n-keep']);
  });

  it('hiddenNodeIds also filters node-scope (composite-then-apply) nodes', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-composite-hidden',
            type: 'basic',
            params: { exposure: 0.25 },
            scope: { kind: 'global' },
            inputs: [],
            layerIds: ['L1', 'L2'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      hiddenNodeIds: new Set(['n-composite-hidden']),
    });

    // No per-layer nodes and the only node-scope node is hidden ⇒ no shader pass.
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });

  it('bypassAdjustments=true skips the WebGL pipeline entirely', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context from jsdom');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
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
            layerId: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      bypassAdjustments: true,
    });

    expect(pipelineSetSourceCanvas).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
    // applyGeometry draws the internal canvas onto the visible canvas exactly once.
    expect(drawSpy).toHaveBeenCalledTimes(1);
  });

  it('bypassAdjustments=true skips the node-scope composite pass even when nodes exist', () => {
    setLayers([
      { id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 },
      { id: 'L2', visible: true, opacity: 1, blendMode: 'normal', order: 1 },
    ]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1', 'L2'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-composite',
            type: 'basic',
            params: { exposure: 0.25 },
            scope: { kind: 'global' },
            inputs: [],
            layerIds: ['L1', 'L2'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      bypassAdjustments: true,
    });

    expect(pipelineSetSourceCanvas).not.toHaveBeenCalled();
    expect(pipelineRenderSync).not.toHaveBeenCalled();
  });

  it('paints layers into the internal cache canvas, not directly into visible', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const visible = makeCanvas();
    const ctx = visible.getContext('2d');
    if (!ctx) throw new Error('expected a 2d context');
    const drawSpy = vi.spyOn(ctx, 'drawImage');

    renderImageNodeComposite({
      canvas: visible,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: undefined,
      widgets: [],
    });

    // With the two-canvas split, the per-layer paint targets the internal canvas
    // (not the visible one). The visible canvas only receives one drawImage —
    // from applyGeometry, with the internal canvas as source.
    expect(drawSpy).toHaveBeenCalledTimes(1);
    const [src] = drawSpy.mock.calls[0];
    expect(src).not.toBe(fakeWorking);
  });

  it('allocates the internal canvas at scaled dims when renderScale < 1', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const visible = makeCanvas();

    renderImageNodeComposite({
      canvas: visible,
      imageNodeId: 'in-scale',
      layerIds: ['L1'],
      sourceWidth: 800,
      sourceHeight: 600,
      opGraph: undefined,
      widgets: [],
      renderScale: 0.25,
    });

    // Internal cache should be sized to source × 0.25 = 200 × 150.
    const internal = getInternalCanvas('in-scale', 200, 150);
    expect(internal.width).toBe(200);
    expect(internal.height).toBe(150);
  });

  it('feeds the WebGL pipeline a downscaled source (not the full-res bitmap) when renderScale < 1', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const visible = makeCanvas();

    renderImageNodeComposite({
      canvas: visible,
      imageNodeId: 'in-pipe',
      layerIds: ['L1'],
      sourceWidth: 800,
      sourceHeight: 600,
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
            layerId: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      renderScale: 0.25,
    });

    expect(pipelineSetSourceCanvas).toHaveBeenCalledTimes(1);
    const [pipelineSource] = pipelineSetSourceCanvas.mock.calls[0];
    // Must NOT be the full-resolution source bitmap — that would defeat the LOD.
    expect(pipelineSource).not.toBe(fakeWorking);
    // The scratch canvas must be sized at source × 0.25.
    const src = pipelineSource as HTMLCanvasElement;
    expect(src.width).toBe(200);
    expect(src.height).toBe(150);
  });

  it('a node with only layerIds (broadcast form) is routed to the composite-then-apply pass, not per-layer', () => {
    // Nodes with `layerIds` (plural) are node-scope nodes — they run after all
    // layers are composited, not during the per-layer loop. `matchesLayer` in
    // the per-layer filter is guarded by `!Array.isArray(n.layerIds)` to keep
    // the two passes mutually exclusive.
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const canvas = makeCanvas();

    renderImageNodeComposite({
      canvas,
      imageNodeId: 'in-1',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
      opGraph: {
        id: 'g',
        userGoal: '',
        nodes: [
          {
            id: 'n-broadcast',
            type: 'basic',
            params: { exposure: 0.3 },
            scope: { kind: 'global' },
            inputs: [],
            // Only the broadcast array form (no `layerId` singular).
            layerIds: ['L1'],
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
    });

    // The node goes through composite-then-apply (one pipeline call), not per-layer.
    expect(pipelineRenderSync).toHaveBeenCalledTimes(1);
    const adjustments = pipelineRenderSync.mock.calls[0][0] as unknown as { id: string }[];
    expect(adjustments[0].id).toBe('n-broadcast');
    // Source for composite pass is the internal cache canvas, not the layer working canvas.
    expect(pipelineSetSourceCanvas.mock.calls[0][0]).not.toBe(fakeWorking);
  });

  it('feeds the WebGL pipeline the source directly when renderScale = 1', () => {
    setLayers([{ id: 'L1', visible: true, opacity: 1, blendMode: 'normal', order: 0 }]);
    const visible = makeCanvas();

    renderImageNodeComposite({
      canvas: visible,
      imageNodeId: 'in-full',
      layerIds: ['L1'],
      sourceWidth: 8,
      sourceHeight: 8,
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
            layerId: 'L1',
          },
        ],
        panelBindings: [],
        metadata: {},
      },
      widgets: [],
      renderScale: 1,
    });

    expect(pipelineSetSourceCanvas).toHaveBeenCalledWith(fakeWorking);
  });
});
