interface LayerCanvases {
  source: OffscreenCanvas;   // Original pixels, never mutated
  working: OffscreenCanvas;  // Clone of source + destructive edits (brush, clone, etc.)
}

class CanvasRegistryImpl {
  private canvases = new Map<string, LayerCanvases>();

  register(layerId: string, source: OffscreenCanvas): void {
    // Clone source into working
    const working = new OffscreenCanvas(source.width, source.height);
    const ctx = working.getContext('2d');
    if (ctx) ctx.drawImage(source, 0, 0);

    this.canvases.set(layerId, { source, working });
  }

  /** Get the working canvas (source + destructive edits). This is what tools read/write. */
  get(layerId: string): OffscreenCanvas | undefined {
    return this.canvases.get(layerId)?.working;
  }

  /** Get the immutable source canvas (original pixels). */
  getSource(layerId: string): OffscreenCanvas | undefined {
    return this.canvases.get(layerId)?.source;
  }

  /** Get both canvases for a layer. */
  getPair(layerId: string): LayerCanvases | undefined {
    return this.canvases.get(layerId);
  }

  /** Reset working canvas back to source (discard all destructive edits). */
  resetToSource(layerId: string): void {
    const pair = this.canvases.get(layerId);
    if (!pair) return;
    const { source, working } = pair;

    // Resize working if needed
    if (working.width !== source.width || working.height !== source.height) {
      working.width = source.width;
      working.height = source.height;
    }

    const ctx = working.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, working.width, working.height);
    ctx.drawImage(source, 0, 0);
  }

  /** Replace the source (e.g. after crop) and reset working to match. */
  replaceSource(layerId: string, newSource: OffscreenCanvas): void {
    const existing = this.canvases.get(layerId);
    const working = new OffscreenCanvas(newSource.width, newSource.height);
    const ctx = working.getContext('2d');
    if (ctx) ctx.drawImage(newSource, 0, 0);

    // Clean up old source if it existed
    if (existing) {
      // OffscreenCanvas doesn't need explicit disposal
    }

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
}

export const CanvasRegistry = new CanvasRegistryImpl();
