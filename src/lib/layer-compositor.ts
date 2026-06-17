import { CanvasRegistry } from './canvas-registry';
import { PipelineManager } from './pipeline-manager';
import { useEditorStore } from '@/store';
import type { BlendMode } from '@/types/adjustment';
import type { Layer } from '@/store/layer-slice';
import { maskStore } from '@/core/mask-store';
import { selectPipelineNodes, matchesLayer } from './select-pipeline-nodes';
import { nodeToAdjustment } from './node-to-adjustment';

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
  private isCompositing = false;
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

  /**
   * Return the cached composite canvas without triggering a new composite.
   * Use this from inside a listener (e.g. a tool's paint callback) — calling
   * compositeSync there would fire executeComposite again and re-enter the
   * listeners, causing infinite recursion.
   */
  getOutput(): HTMLCanvasElement {
    return this.outputCanvas;
  }

  /** Render a single layer through its adjustment pipeline. Returns an HTMLCanvasElement. */
  renderLayer(layer: Layer, seen: Set<string> = new Set()): HTMLCanvasElement | null {
    // Cycle / self-reference guard. A malformed layer tree (e.g. a layer
    // pointing to itself or a closed loop) would otherwise recurse
    // infinitely and crash the tab. Bail and log instead.
    if (seen.has(layer.id)) {
      console.warn('LayerCompositor: cycle detected in parentLayerId chain', {
        layerId: layer.id, chain: Array.from(seen),
      });
      return null;
    }
    seen.add(layer.id);

    // 1. Determine source pixels.
    let source: HTMLCanvasElement | OffscreenCanvas | null;
    if (layer.parentLayerId) {
      const parent = useEditorStore.getState().layers.find((l) => l.id === layer.parentLayerId);
      if (!parent) return null;
      source = this.renderLayer(parent, seen);
      if (!source) return null;
    } else {
      source = CanvasRegistry.get(layer.id) ?? null;
      if (!source) return null;
    }

    // 2. Apply the layer's adjustment pipeline from the backend snapshot.
    const pipelineNodes = selectPipelineNodes().filter((n) => matchesLayer(n, layer.id));
    const adjustments = pipelineNodes.map(nodeToAdjustment).filter((a) => a.enabled);
    let result: HTMLCanvasElement;
    if (adjustments.length === 0) {
      result = document.createElement('canvas');
      result.width = source.width;
      result.height = source.height;
      const ctx = result.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0);
    } else {
      PipelineManager.setSourceCanvas(source);
      result = PipelineManager.renderSync([...adjustments]);
    }

    // 3. Apply the layer mask, if any (multiply alpha by mask).
    if (layer.layerMask) {
      const mask = maskStore.get(layer.layerMask);
      if (mask && mask.width === result.width && mask.height === result.height) {
        const ctx = result.getContext('2d');
        if (ctx) {
          const imgData = ctx.getImageData(0, 0, result.width, result.height);
          for (let i = 0; i < mask.data.length; i++) {
            imgData.data[i * 4 + 3] = (imgData.data[i * 4 + 3] * mask.data[i]) / 255;
          }
          ctx.putImageData(imgData, 0, 0);
        }
      }
    }

    return result;
  }

  private executeComposite(): void {
    // Re-entry guard: a listener that triggers another composite (e.g. via
    // compositeSync from an unaware caller) must not re-enter the pipeline.
    if (this.isCompositing) return;
    this.isCompositing = true;
    try {
      this.executeCompositeInner();
    } finally {
      this.isCompositing = false;
    }
  }

  private executeCompositeInner(): void {
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
      const hasPixels = CanvasRegistry.has(layer.id);
      const isBranched = !!layer.parentLayerId;
      let rendered: HTMLCanvasElement | null = null;
      if (hasPixels || isBranched) {
        rendered = this.renderLayer(layer);
      } else {
        // Pixel-less adjustment-only layer: apply backend pipeline nodes over
        // the accumulated composite below it.
        const pipelineNodes = selectPipelineNodes().filter((n) => matchesLayer(n, layer.id));
        const enabledAdjs = pipelineNodes.map(nodeToAdjustment).filter((a) => a.enabled);
        if (enabledAdjs.length > 0 && outputWidth > 0 && outputHeight > 0) {
          PipelineManager.setSourceCanvas(this.outputCanvas);
          rendered = PipelineManager.renderSync([...enabledAdjs]);
        }
      }
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
