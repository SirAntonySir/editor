import { WebGLPipeline } from '@/shaders/pipeline';
import { CanvasRegistry } from './canvas-registry';
import type { Adjustment } from '@/types/adjustment';
import type { HiBitImage } from './png16';

class PipelineManagerImpl {
  private pipeline: WebGLPipeline | null = null;
  private currentLayerId: string | null = null;
  private rafId: number | null = null;
  private pendingRender = false;
  private onRender: ((canvas: HTMLCanvasElement) => void) | null = null;
  private currentAdjustments: Adjustment[] = [];
  private listeners = new Set<(canvas: HTMLCanvasElement) => void>();

  private getPipeline(): WebGLPipeline {
    if (!this.pipeline) {
      this.pipeline = new WebGLPipeline();
    }
    return this.pipeline;
  }

  setRenderCallback(cb: (canvas: HTMLCanvasElement) => void): void {
    this.onRender = cb;
  }

  setSource(layerId: string): void {
    const source = CanvasRegistry.get(layerId);
    if (!source) return;
    this.currentLayerId = layerId;
    this.getPipeline().setSource(source);
  }

  /**
   * Use an arbitrary canvas (not a registered layer) as the pipeline source.
   * Used by adjustment layers — pixel-less layers whose adjustments transform
   * the accumulated composite of layers below them.
   */
  setSourceCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, dirty = true): void {
    this.currentLayerId = null;
    this.getPipeline().setSource(canvas, dirty);
  }

  /** Whether the GPU supports the high-bit-depth (RGBA16F) float path. */
  supportsFloat(): boolean {
    return this.getPipeline().supportsFloat();
  }

  /**
   * Use a high-bit-depth (RGBA-16) image as the pipeline source — the float
   * path. `currentLayerId` is cleared so the RAF/sync render doesn't re-upload
   * the layer's 8-bit canvas over it. Returns false when float is unsupported
   * (caller falls back to `setSourceCanvas`).
   */
  setHiBitSource(img: HiBitImage, dirty = true): boolean {
    this.currentLayerId = null;
    return this.getPipeline().setHiBitSource(img, dirty);
  }

  requestRender(adjustments: Adjustment[]): void {
    this.currentAdjustments = adjustments;
    if (!this.pendingRender) {
      this.pendingRender = true;
      this.rafId = requestAnimationFrame(() => {
        this.pendingRender = false;
        this.rafId = null;
        this.executeRender();
      });
    }
  }

  renderSync(adjustments: Adjustment[]): HTMLCanvasElement {
    this.currentAdjustments = adjustments;
    return this.executeRender(true);
  }

  private executeRender(silent = false): HTMLCanvasElement {
    const pipeline = this.getPipeline();
    if (this.currentLayerId) {
      const source = CanvasRegistry.get(this.currentLayerId);
      if (source) {
        pipeline.setSource(source);
      }
    }
    const output = pipeline.render(this.currentAdjustments);
    if (!silent) {
      this.onRender?.(output);
      for (const cb of this.listeners) cb(output);
    }
    return output;
  }

  getOutput(): HTMLCanvasElement | null {
    return this.pipeline?.getOutputCanvas() ?? null;
  }

  subscribe(cb: (canvas: HTMLCanvasElement) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.pipeline?.dispose();
    this.pipeline = null;
    this.onRender = null;
  }
}

export const PipelineManager = new PipelineManagerImpl();
