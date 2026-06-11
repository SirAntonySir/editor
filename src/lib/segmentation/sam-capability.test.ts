import { describe, expect, it, vi, afterEach } from 'vitest';
import { detectSamCapability } from './sam-capability';

interface NavWithGpu {
  gpu?: { requestAdapter: () => Promise<unknown> };
}

afterEach(() => {
  delete (globalThis.navigator as NavWithGpu).gpu;
  vi.restoreAllMocks();
});

describe('detectSamCapability', () => {
  it('returns "webgpu" when navigator.gpu.requestAdapter resolves to an adapter', async () => {
    (globalThis.navigator as NavWithGpu).gpu = {
      requestAdapter: vi.fn(async () => ({})),  // truthy adapter
    };
    expect(await detectSamCapability()).toBe('webgpu');
  });

  it('falls through to "wasm" when navigator.gpu is missing', async () => {
    delete (globalThis.navigator as NavWithGpu).gpu;
    expect(await detectSamCapability()).toBe('wasm');
  });

  it('falls through to "wasm" when requestAdapter resolves to null', async () => {
    (globalThis.navigator as NavWithGpu).gpu = {
      requestAdapter: vi.fn(async () => null),
    };
    expect(await detectSamCapability()).toBe('wasm');
  });

  it('falls through to "wasm" when requestAdapter throws', async () => {
    (globalThis.navigator as NavWithGpu).gpu = {
      requestAdapter: vi.fn(async () => { throw new Error('denied'); }),
    };
    expect(await detectSamCapability()).toBe('wasm');
  });

  it('returns "backend" when WebAssembly is unavailable', async () => {
    delete (globalThis.navigator as NavWithGpu).gpu;
    const wasm = (globalThis as { WebAssembly?: unknown }).WebAssembly;
    delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
    try {
      expect(await detectSamCapability()).toBe('backend');
    } finally {
      (globalThis as { WebAssembly?: unknown }).WebAssembly = wasm;
    }
  });
});
