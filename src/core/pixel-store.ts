/**
 * PixelStore — manages OffscreenCanvas pairs (source + working) for each layer.
 * Replaces CanvasRegistry with identical API plus snapshot/serialize capabilities.
 */

interface LayerCanvases {
  source: OffscreenCanvas;
  working: OffscreenCanvas;
}

class PixelStoreImpl {
  private canvases = new Map<string, LayerCanvases>();

  register(layerId: string, source: OffscreenCanvas): void {
    const working = new OffscreenCanvas(source.width, source.height);
    const ctx = working.getContext('2d');
    if (ctx) ctx.drawImage(source, 0, 0);
    this.canvases.set(layerId, { source, working });
  }

  get(layerId: string): OffscreenCanvas | undefined {
    return this.canvases.get(layerId)?.working;
  }

  getSource(layerId: string): OffscreenCanvas | undefined {
    return this.canvases.get(layerId)?.source;
  }

  getPair(layerId: string): LayerCanvases | undefined {
    return this.canvases.get(layerId);
  }

  resetToSource(layerId: string): void {
    const pair = this.canvases.get(layerId);
    if (!pair) return;
    const { source, working } = pair;
    if (working.width !== source.width || working.height !== source.height) {
      working.width = source.width;
      working.height = source.height;
    }
    const ctx = working.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, working.width, working.height);
    ctx.drawImage(source, 0, 0);
  }

  replaceSource(layerId: string, newSource: OffscreenCanvas): void {
    const working = new OffscreenCanvas(newSource.width, newSource.height);
    const ctx = working.getContext('2d');
    if (ctx) ctx.drawImage(newSource, 0, 0);
    this.canvases.set(layerId, { source: newSource, working });
  }

  remove(layerId: string): boolean {
    return this.canvases.delete(layerId);
  }

  clear(): void {
    this.canvases.clear();
  }

  has(layerId: string): boolean {
    return this.canvases.has(layerId);
  }

  get size(): number {
    return this.canvases.size;
  }

  // ─── Snapshot / restore (for history) ─────────────────────────────

  /** Capture the working canvas as a compressed WebP blob. */
  async captureSnapshot(layerId: string): Promise<Blob> {
    const working = this.canvases.get(layerId)?.working;
    if (!working) throw new Error(`No canvas for layer ${layerId}`);
    return working.convertToBlob({ type: 'image/webp', quality: 0.85 });
  }

  /** Restore a working canvas from a blob snapshot. */
  async restoreSnapshot(layerId: string, blob: Blob): Promise<void> {
    const pair = this.canvases.get(layerId);
    if (!pair) return;
    const bitmap = await createImageBitmap(blob);
    const { working } = pair;
    if (working.width !== bitmap.width || working.height !== bitmap.height) {
      working.width = bitmap.width;
      working.height = bitmap.height;
    }
    const ctx = working.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, working.width, working.height);
      ctx.drawImage(bitmap, 0, 0);
    }
    bitmap.close();
  }

  /** Capture snapshots for multiple layers. */
  async captureSnapshots(layerIds: string[]): Promise<Map<string, Blob>> {
    const entries = await Promise.all(
      layerIds
        .filter((id) => this.canvases.has(id))
        .map(async (id) => [id, await this.captureSnapshot(id)] as const),
    );
    return new Map(entries);
  }

  /** Restore snapshots for multiple layers. */
  async restoreSnapshots(snapshots: Map<string, Blob>): Promise<void> {
    await Promise.all(
      Array.from(snapshots.entries()).map(([id, blob]) =>
        this.restoreSnapshot(id, blob),
      ),
    );
  }

  // ─── Export / import (for .edp serialization) ─────────────────────

  /** Export a layer canvas as PNG blob. */
  async exportLayerAsPng(
    layerId: string,
    which: 'source' | 'working',
  ): Promise<Blob> {
    const pair = this.canvases.get(layerId);
    if (!pair) throw new Error(`No canvas for layer ${layerId}`);
    const canvas = which === 'source' ? pair.source : pair.working;
    return canvas.convertToBlob({ type: 'image/png' });
  }

  /** Import a layer canvas from a PNG blob. */
  async importLayerFromPng(
    layerId: string,
    blob: Blob,
    which: 'source' | 'working',
  ): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    const pair = this.canvases.get(layerId);

    if (!pair) {
      // Create new pair
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const sCtx = source.getContext('2d');
      if (sCtx) sCtx.drawImage(bitmap, 0, 0);
      const working = new OffscreenCanvas(bitmap.width, bitmap.height);
      const wCtx = working.getContext('2d');
      if (wCtx) wCtx.drawImage(bitmap, 0, 0);
      this.canvases.set(layerId, { source, working });
    } else {
      const canvas = which === 'source' ? pair.source : pair.working;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);
      }
    }

    bitmap.close();
  }
}

export const pixelStore = new PixelStoreImpl();
