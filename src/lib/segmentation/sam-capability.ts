/**
 * Detect the best SAM runtime available in this browser.
 *
 *   'webgpu'  — MobileSAM runs in-browser via ONNX Runtime Web + WebGPU.
 *               ~20 ms per click, ~300-800 ms encoder warmup. Best UX.
 *   'wasm'    — MobileSAM runs in-browser via ONNX Runtime Web + WebAssembly.
 *               ~100-300 ms per click. Acceptable.
 *   'backend' — Server-side SAM 2 via `propose_mask`. ~150-300 ms round-trip
 *               on a fast link, slower on flaky networks. The fallback.
 *
 * Probed once at first call; callers cache the result for the session.
 */
export type SamCapability = 'webgpu' | 'wasm' | 'backend';

export async function detectSamCapability(): Promise<SamCapability> {
  if (await hasWebGpu()) return 'webgpu';
  if (hasWebAssembly()) return 'wasm';
  return 'backend';
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

function hasWebAssembly(): boolean {
  // WebAssembly is a global namespace in modern browsers; the check is
  // existence + the `instantiate` function being callable.
  const wasm = (globalThis as { WebAssembly?: { instantiate?: unknown } }).WebAssembly;
  return !!wasm && typeof wasm.instantiate === 'function';
}
