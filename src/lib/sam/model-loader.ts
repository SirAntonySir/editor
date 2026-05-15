import * as ort from 'onnxruntime-web';

// Quantized SAM ViT-B / SlimSAM from Xenova (Hugging Face) — pre-converted to ONNX.
// SlimSAM-77 is smaller (~80 MB total) and faster; ViT-B is ~92 MB encoder.
// Update these URLs to point at a CDN you control before shipping to production.
// For thesis demo, Xenova-hosted is acceptable.
const SAM_ENCODER_URL = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/vision_encoder_quantized.onnx';
const SAM_DECODER_URL = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/prompt_encoder_mask_decoder.onnx';

const DB_NAME = 'sam-models';
const STORE_NAME = 'sessions';
const VERSION_KEY = 'v1';

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIdb(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function saveToIdb(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function fetchModel(url: string, onProgress?: (frac: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`SAM model fetch failed: ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && onProgress) onProgress(received / total);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  return buf.buffer;
}

let encoderPromise: Promise<ort.InferenceSession> | null = null;
let decoderPromise: Promise<ort.InferenceSession> | null = null;

export interface ModelLoadProgress {
  encoder: number;
  decoder: number;
}

const progressListeners = new Set<(p: ModelLoadProgress) => void>();
const progress: ModelLoadProgress = { encoder: 0, decoder: 0 };
function emitProgress() { for (const cb of progressListeners) cb({ ...progress }); }

export function onModelLoadProgress(cb: (p: ModelLoadProgress) => void): () => void {
  progressListeners.add(cb);
  return () => { progressListeners.delete(cb); };
}

async function loadOrFetch(url: string, idbKey: string, which: 'encoder' | 'decoder'): Promise<ArrayBuffer> {
  const cached = await loadFromIdb(idbKey);
  if (cached) {
    progress[which] = 1;
    emitProgress();
    return cached;
  }
  const buf = await fetchModel(url, (frac) => {
    progress[which] = frac;
    emitProgress();
  });
  await saveToIdb(idbKey, buf);
  return buf;
}

export async function getEncoder(): Promise<ort.InferenceSession> {
  if (!encoderPromise) {
    encoderPromise = (async () => {
      const buf = await loadOrFetch(SAM_ENCODER_URL, `${VERSION_KEY}/encoder`, 'encoder');
      return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    })();
  }
  return encoderPromise;
}

export async function getDecoder(): Promise<ort.InferenceSession> {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const buf = await loadOrFetch(SAM_DECODER_URL, `${VERSION_KEY}/decoder`, 'decoder');
      return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    })();
  }
  return decoderPromise;
}
