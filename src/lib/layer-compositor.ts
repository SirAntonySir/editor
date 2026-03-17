import { CanvasRegistry } from './canvas-registry';
import { PipelineManager } from './pipeline-manager';
import { useEditorStore } from '@/store';
import type { Layer, BlendMode } from '@/store/layer-slice';

const BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation> = {
  'normal': 'source-over',
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
};

class LayerCompositorImpl {
  private outputCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private pendingRender = false;
  private onComposite: ((canvas: HTMLCanvasElement) => void) | null = null;
  private listeners = new Set<(canvas: HTMLCanvasElement) => void>();

  constructor() {
    this.outputCanvas = document.createElement('canvas');
    const ctx = this.outputCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    this.ctx = ctx;
  }

  setCompositeCallback(cb: (canvas: HTMLCanvasElement) => void): void {
    this.onComposite = cb;
  }

  requestComposite(): void {
    if (!this.pendingRender) {
      this.pendingRender = true;
      this.rafId = requestAnimationFrame(() => {
        this.pendingRender = false;
        this.rafId = null;
        this.executeComposite();
      });
    }
  }

  compositeSync(): HTMLCanvasElement {
    this.executeComposite();
    return this.outputCanvas;
  }

  /** Render a single layer through its adjustment pipeline. Returns an HTMLCanvasElement. */
  renderLayer(layer: Layer): HTMLCanvasElement | null {
    const working = CanvasRegistry.get(layer.id);
    if (!working) return null;

    const adjustments = layer.adjustmentStack.adjustments.filter((a) => a.enabled);

    if (adjustments.length === 0) {
      // No adjustments — just convert working to HTMLCanvasElement
      const tmp = document.createElement('canvas');
      tmp.width = working.width;
      tmp.height = working.height;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) return null;
      tmpCtx.drawImage(working, 0, 0);
      return tmp;
    }

    // Render through WebGL pipeline
    PipelineManager.setSource(layer.id);
    return PipelineManager.renderSync([...adjustments]);
  }

  private executeComposite(): void {
    const state = useEditorStore.getState();
    const layers = state.layers;
    const visibleLayers = layers
      .filter((l) => l.visible)
      .sort((a, b) => a.order - b.order); // bottom to top

    if (visibleLayers.length === 0) {
      this.ctx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
      this.onComposite?.(this.outputCanvas);
      return;
    }

    // Determine output size from the first layer with pixel data
    let outputWidth = 0;
    let outputHeight = 0;
    for (const layer of visibleLayers) {
      const working = CanvasRegistry.get(layer.id);
      if (working) {
        outputWidth = Math.max(outputWidth, working.width);
        outputHeight = Math.max(outputHeight, working.height);
      }
    }

    if (outputWidth === 0 || outputHeight === 0) return;

    if (this.outputCanvas.width !== outputWidth || this.outputCanvas.height !== outputHeight) {
      this.outputCanvas.width = outputWidth;
      this.outputCanvas.height = outputHeight;
    }

    this.ctx.clearRect(0, 0, outputWidth, outputHeight);

    for (const layer of visibleLayers) {
      const rendered = this.renderLayer(layer);
      if (!rendered) continue;

      this.ctx.save();
      this.ctx.globalAlpha = layer.opacity;
      this.ctx.globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode] ?? 'source-over';
      this.ctx.drawImage(rendered, 0, 0);
      this.ctx.restore();
    }

    this.onComposite?.(this.outputCanvas);
    for (const cb of this.listeners) cb(this.outputCanvas);
  }

  subscribe(cb: (canvas: HTMLCanvasElement) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.onComposite = null;
  }
}

export const LayerCompositor = new LayerCompositorImpl();
