import * as Comlink from 'comlink';

class ProcessingWorker {
  async applyGrayscale(imageData: ImageData): Promise<ImageData> {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      data[i] = avg;
      data[i + 1] = avg;
      data[i + 2] = avg;
    }
    return imageData;
  }

  async gaussianBlur(imageData: ImageData, radius: number): Promise<ImageData> {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const size = Math.max(1, Math.round(radius));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let dy = -size; dy <= size; dy++) {
          for (let dx = -size; dx <= size; dx++) {
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            const ny = Math.min(height - 1, Math.max(0, y + dy));
            const idx = (ny * width + nx) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            a += data[idx + 3];
            count++;
          }
        }
        const idx = (y * width + x) * 4;
        output[idx] = r / count;
        output[idx + 1] = g / count;
        output[idx + 2] = b / count;
        output[idx + 3] = a / count;
      }
    }

    return new ImageData(output, width, height);
  }

  async sharpen(imageData: ImageData, amount: number): Promise<ImageData> {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const k = amount;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const center = data[idx + c];
          const top = data[((y - 1) * width + x) * 4 + c];
          const bottom = data[((y + 1) * width + x) * 4 + c];
          const left = data[(y * width + (x - 1)) * 4 + c];
          const right = data[(y * width + (x + 1)) * 4 + c];
          const laplacian = center * 4 - top - bottom - left - right;
          output[idx + c] = Math.max(0, Math.min(255, center + k * laplacian));
        }
        output[idx + 3] = data[idx + 3];
      }
    }

    return new ImageData(output, width, height);
  }

  async resize(
    imageData: ImageData,
    newWidth: number,
    newHeight: number,
  ): Promise<ImageData> {
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);

    const resized = new OffscreenCanvas(newWidth, newHeight);
    const rCtx = resized.getContext('2d')!;
    rCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

    return rCtx.getImageData(0, 0, newWidth, newHeight);
  }
}

Comlink.expose(new ProcessingWorker());
