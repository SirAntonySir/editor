class CanvasRegistryImpl {
  private canvases = new Map<string, OffscreenCanvas>();

  register(layerId: string, canvas: OffscreenCanvas): void {
    this.canvases.set(layerId, canvas);
  }

  get(layerId: string): OffscreenCanvas | undefined {
    return this.canvases.get(layerId);
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
