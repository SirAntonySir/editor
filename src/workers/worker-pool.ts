import * as Comlink from 'comlink';

type WorkerApi = {
  applyGrayscale(imageData: ImageData): Promise<ImageData>;
  gaussianBlur(imageData: ImageData, radius: number): Promise<ImageData>;
  sharpen(imageData: ImageData, amount: number): Promise<ImageData>;
  resize(imageData: ImageData, newWidth: number, newHeight: number): Promise<ImageData>;
};

class WorkerPoolImpl {
  private workers: Comlink.Remote<WorkerApi>[] = [];
  private rawWorkers: Worker[] = [];
  private nextIdx = 0;
  private poolSize: number;

  constructor() {
    this.poolSize = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 8));
  }

  private ensureWorkers(): void {
    if (this.workers.length > 0) return;
    for (let i = 0; i < this.poolSize; i++) {
      const raw = new Worker(
        new URL('./processing.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.rawWorkers.push(raw);
      this.workers.push(Comlink.wrap<WorkerApi>(raw));
    }
  }

  private getWorker(): Comlink.Remote<WorkerApi> {
    this.ensureWorkers();
    const worker = this.workers[this.nextIdx % this.workers.length];
    this.nextIdx++;
    return worker;
  }

  async applyGrayscale(imageData: ImageData): Promise<ImageData> {
    return this.getWorker().applyGrayscale(Comlink.transfer(imageData, [imageData.data.buffer]));
  }

  async gaussianBlur(imageData: ImageData, radius: number): Promise<ImageData> {
    return this.getWorker().gaussianBlur(Comlink.transfer(imageData, [imageData.data.buffer]), radius);
  }

  async sharpen(imageData: ImageData, amount: number): Promise<ImageData> {
    return this.getWorker().sharpen(Comlink.transfer(imageData, [imageData.data.buffer]), amount);
  }

  async resize(imageData: ImageData, w: number, h: number): Promise<ImageData> {
    return this.getWorker().resize(Comlink.transfer(imageData, [imageData.data.buffer]), w, h);
  }

  terminate(): void {
    this.rawWorkers.forEach((w) => w.terminate());
    this.rawWorkers = [];
    this.workers = [];
  }
}

export const WorkerPool = new WorkerPoolImpl();
