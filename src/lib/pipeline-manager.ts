import { WebGLPipeline } from '@/shaders/pipeline';
import { CanvasRegistry } from './canvas-registry';
import type { Adjustment } from '@/store/layer-slice';

class PipelineManagerImpl {
  private pipeline: WebGLPipeline | null = null;
  private currentLayerId: string | null = null;
  private rafId: number | null = null;
  private pendingRender = false;
  private onRender: ((canvas: HTMLCanvasElement) => void) | null = null;
  private currentAdjustments: Adjustment[] = [];

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
    return this.executeRender();
  }

  private executeRender(): HTMLCanvasElement {
    const pipeline = this.getPipeline();
    if (this.currentLayerId) {
      const source = CanvasRegistry.get(this.currentLayerId);
      if (source) {
        pipeline.setSource(source);
      }
    }
    const output = pipeline.render(this.currentAdjustments);
    this.onRender?.(output);
    return output;
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
