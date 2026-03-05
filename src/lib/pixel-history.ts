interface PixelSnapshot {
  id: string;
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blob: Blob;
  timestamp: number;
}

class PixelHistoryManagerImpl {
  private history: PixelSnapshot[] = [];
  private redoStack: PixelSnapshot[] = [];
  private maxEntries = 50;

  async captureRegion(
    layerId: string,
    source: OffscreenCanvas,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<string> {
    const regionCanvas = new OffscreenCanvas(width, height);
    const ctx = regionCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');

    ctx.drawImage(source, x, y, width, height, 0, 0, width, height);

    const blob = await regionCanvas.convertToBlob({
      type: 'image/webp',
      quality: 0.8,
    });

    const id = crypto.randomUUID();
    const snapshot: PixelSnapshot = {
      id,
      layerId,
      x,
      y,
      width,
      height,
      blob,
      timestamp: Date.now(),
    };

    this.history.push(snapshot);
    this.redoStack = [];

    // Enforce memory budget
    while (this.history.length > this.maxEntries) {
      this.history.shift();
    }

    return id;
  }

  async captureFullCanvas(layerId: string, source: OffscreenCanvas): Promise<string> {
    return this.captureRegion(layerId, source, 0, 0, source.width, source.height);
  }

  async undo(target: OffscreenCanvas): Promise<boolean> {
    const snapshot = this.history.pop();
    if (!snapshot) return false;

    // Capture current state for redo before restoring
    const redoCanvas = new OffscreenCanvas(snapshot.width, snapshot.height);
    const redoCtx = redoCanvas.getContext('2d');
    if (redoCtx) {
      redoCtx.drawImage(
        target,
        snapshot.x, snapshot.y, snapshot.width, snapshot.height,
        0, 0, snapshot.width, snapshot.height,
      );
      const redoBlob = await redoCanvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
      this.redoStack.push({ ...snapshot, blob: redoBlob });
    }

    // Restore snapshot
    const bitmap = await createImageBitmap(snapshot.blob);
    const ctx = target.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, snapshot.x, snapshot.y);
    bitmap.close();

    return true;
  }

  async redo(target: OffscreenCanvas): Promise<boolean> {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;

    // Capture current for undo
    const undoCanvas = new OffscreenCanvas(snapshot.width, snapshot.height);
    const undoCtx = undoCanvas.getContext('2d');
    if (undoCtx) {
      undoCtx.drawImage(
        target,
        snapshot.x, snapshot.y, snapshot.width, snapshot.height,
        0, 0, snapshot.width, snapshot.height,
      );
      const undoBlob = await undoCanvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
      this.history.push({ ...snapshot, blob: undoBlob });
    }

    const bitmap = await createImageBitmap(snapshot.blob);
    const ctx = target.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bitmap, snapshot.x, snapshot.y);
    bitmap.close();

    return true;
  }

  clear(): void {
    this.history = [];
    this.redoStack = [];
  }

  get undoCount(): number {
    return this.history.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }
}

export const PixelHistoryManager = new PixelHistoryManagerImpl();
