import { describe, expect, it, vi, beforeEach } from 'vitest';
import { decode, encode, loadSessions, _resetForTests } from './mobile-sam-client';

const mockEncoderRun = vi.fn();
const mockDecoderRun = vi.fn();
const mockSessionCreate = vi.fn();
const mockTensor = vi.fn(function MockTensor(
  this: { type: string; data: Float32Array; dims: number[] },
  type: string,
  data: Float32Array,
  dims: number[],
) {
  this.type = type;
  this.data = data;
  this.dims = dims;
});

vi.mock('onnxruntime-web', () => {
  return {
    InferenceSession: { create: mockSessionCreate },
    Tensor: mockTensor,
    env: { wasm: { numThreads: 1 } },
  };
});

const fakeEncoderOutput = {
  image_embeddings: { data: new Float32Array(64), dims: [1, 256, 64, 64] },
};

beforeEach(() => {
  _resetForTests();
  mockSessionCreate.mockReset();
  mockEncoderRun.mockReset();
  mockDecoderRun.mockReset();
  mockEncoderRun.mockResolvedValue(fakeEncoderOutput);
  mockSessionCreate.mockImplementation(async (url: string) => {
    if (url.includes('encoder')) return { run: mockEncoderRun };
    return { run: mockDecoderRun };
  });
});

// Minimal ImageBitmap-like object for Node (createImageBitmap is not available).
function makeFakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

// OffscreenCanvas is not available in Node vitest; stub it so encode() doesn't crash.
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
      };
    }
  }
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
}

describe('loadSessions', () => {
  it('creates both sessions exactly once across repeated calls', async () => {
    await loadSessions();
    await loadSessions();
    await loadSessions();
    expect(mockSessionCreate).toHaveBeenCalledTimes(2); // encoder + decoder
  });
});

describe('encode', () => {
  it('runs the encoder once per call', async () => {
    const bitmap = makeFakeBitmap(1024, 1024);
    const out = await encode(bitmap);
    expect(out.imageWidth).toBe(1024);
    expect(out.imageHeight).toBe(1024);
    expect(out.embedding).toBe(fakeEncoderOutput.image_embeddings);
    expect(mockEncoderRun).toHaveBeenCalledTimes(1);
  });
});

describe('decode', () => {
  it('returns an empty mask when given zero points (no decoder call)', async () => {
    const embedding = { imageWidth: 10, imageHeight: 10, embedding: {} };
    const out = await decode(embedding, []);
    expect(out.width).toBe(10);
    expect(out.height).toBe(10);
    expect(out.data.length).toBe(100);
    expect(out.data.every((v) => v === 0)).toBe(true);
    expect(mockDecoderRun).not.toHaveBeenCalled();
  });

  it('thresholds decoder logits at 0 into a 0/255 mask', async () => {
    mockDecoderRun.mockResolvedValueOnce({
      masks: { data: new Float32Array([1.5, -0.5, 0.1, -2.0]), dims: [1, 2, 2] },
    });
    const embedding = { imageWidth: 2, imageHeight: 2, embedding: {} };
    const out = await decode(embedding, [{ x: 0.5, y: 0.5, label: 1 }]);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual([255, 0, 255, 0]);
    expect(mockDecoderRun).toHaveBeenCalledTimes(1);
  });
});
