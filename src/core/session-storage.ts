/**
 * Session persistence via IndexedDB.
 *
 * Auto-saves the editor state (layers, adjustments, graph positions,
 * viewport, document meta) and pixel data so work survives page refreshes.
 *
 * IndexedDB is used instead of localStorage because pixel data (PNG blobs)
 * can easily exceed the ~5MB localStorage limit.
 *
 * Database: 'editor-session', version 1
 * Object stores:
 *   'state'  — single record (key 'current') with the serialized manifest
 *   'pixels' — one record per layer (key = layerId, value = PNG Blob)
 */

import type { DocumentMeta } from './types';
import type { HistoryTreeSnapshot } from './types';
import type { Layer, Adjustment, AiSource } from '@/store/layer-slice';
import type { NodePosition } from '@/types/graph';
import type { ImageContext } from '@/types/image-context';
import { exportAllCurvePoints, importAllCurvePoints } from '@/lib/curve-points-store';

// ─── Serializable types (mirror serializer.ts) ──────────────────────

type SerializableParams = Record<string, number | number[]>;

interface SerializableAdjustment {
  id: string;
  type: Adjustment['type'];
  name: string;
  enabled: boolean;
  blendMode: Adjustment['blendMode'];
  opacity: number;
  params: SerializableParams;
  aiSource?: AiSource;
}

interface SerializableLayer {
  id: string;
  type: Layer['type'];
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: Layer['blendMode'];
  locked: boolean;
  order: number;
  adjustmentStack: { adjustments: SerializableAdjustment[] };
  textMeta?: Layer['textMeta'];
  cropMeta?: Layer['cropMeta'];
}

interface SessionManifest {
  meta: DocumentMeta;
  layers: SerializableLayer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  editorMode: string;
  savedAt: number;
  curvePoints?: Record<string, Record<string, number[]>>;
  /** Tree-structured history; absent in pre-v2 sessions. */
  history?: HistoryTreeSnapshot;
  /** Cached image context — saves a Claude analyse call on reload. */
  imageContext?: ImageContext;
}

export interface SessionData {
  manifest: SessionManifest;
  pixels: Map<string, Blob>;
  /** key format: `${nodeId}:${pre|post}:${layerId}` */
  historyPixels: Map<string, Blob>;
}

// ─── Param serialization ─────────────────────────────────────────────

function serializeParams(params: Record<string, number | Float32Array>): SerializableParams {
  const result: SerializableParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'object' && value !== null && 'length' in value) {
      result[key] = Array.from(value as Float32Array);
    } else {
      result[key] = value as number;
    }
  }
  return result;
}

function deserializeParams(params: SerializableParams): Record<string, number | Float32Array> {
  const result: Record<string, number | Float32Array> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = Array.isArray(value) ? new Float32Array(value) : value;
  }
  return result;
}

function serializeLayer(layer: Layer): SerializableLayer {
  return {
    id: layer.id,
    type: layer.type,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    order: layer.order,
    adjustmentStack: {
      adjustments: layer.adjustmentStack.adjustments.map((adj) => ({
        id: adj.id,
        type: adj.type,
        name: adj.name,
        enabled: adj.enabled,
        blendMode: adj.blendMode,
        opacity: adj.opacity,
        params: serializeParams(adj.params),
        aiSource: adj.aiSource,
      })),
    },
    textMeta: layer.textMeta,
    cropMeta: layer.cropMeta,
  };
}

function deserializeLayer(sl: SerializableLayer): Layer {
  return {
    id: sl.id,
    type: sl.type,
    name: sl.name,
    visible: sl.visible,
    opacity: sl.opacity,
    blendMode: sl.blendMode,
    locked: sl.locked,
    order: sl.order,
    adjustmentStack: {
      adjustments: sl.adjustmentStack.adjustments.map((adj) => ({
        id: adj.id,
        type: adj.type,
        name: adj.name,
        enabled: adj.enabled,
        blendMode: adj.blendMode,
        opacity: adj.opacity,
        params: deserializeParams(adj.params),
        aiSource: adj.aiSource,
      })),
    },
    textMeta: sl.textMeta,
    cropMeta: sl.cropMeta,
  };
}

// ─── IndexedDB helpers ───────────────────────────────────────────────

const DB_NAME = 'editor-session';
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('pixels')) db.createObjectStore('pixels');
      if (!db.objectStoreNames.contains('history-pixels')) db.createObjectStore('history-pixels');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAllKeys(db: IDBDatabase, storeName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── Public API ──────────────────────────────────────────────────────

export interface SaveSessionOptions {
  meta: DocumentMeta;
  layers: Layer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  editorMode: string;
  history?: HistoryTreeSnapshot;
  historyPixelBlobs?: Map<string, Blob>;
  imageContext?: ImageContext;
  pixelStore: {
    has(id: string): boolean;
    exportLayerAsPng(id: string, which: 'source' | 'working'): Promise<Blob>;
  };
}

/** Save current editor state + pixel data to IndexedDB. */
export async function saveSession(options: SaveSessionOptions): Promise<void> {
  const { meta, layers, activeLayerId, graphPositions, viewport, editorMode, history, historyPixelBlobs, imageContext, pixelStore } = options;

  const db = await openDB();

  try {
    // Serialize manifest
    const manifest: SessionManifest = {
      meta,
      layers: layers.map(serializeLayer),
      activeLayerId,
      graphPositions,
      viewport,
      editorMode,
      savedAt: Date.now(),
      curvePoints: exportAllCurvePoints(),
      history,
      imageContext,
    };
    await idbPut(db, 'state', 'current', manifest);

    // Clear old pixels, then save current ones
    await idbClear(db, 'pixels');
    for (const layer of layers) {
      if (pixelStore.has(layer.id)) {
        const blob = await pixelStore.exportLayerAsPng(layer.id, 'source');
        await idbPut(db, 'pixels', layer.id, blob);
      }
    }

    await idbClear(db, 'history-pixels');
    if (historyPixelBlobs) {
      for (const [key, blob] of historyPixelBlobs) {
        await idbPut(db, 'history-pixels', key, blob);
      }
    }
  } finally {
    db.close();
  }
}

/** Check if a saved session exists. */
export async function hasSession(): Promise<boolean> {
  try {
    const db = await openDB();
    const manifest = await idbGet<SessionManifest>(db, 'state', 'current');
    db.close();
    return manifest != null && manifest.layers.length > 0;
  } catch {
    return false;
  }
}

/** Load saved session from IndexedDB. Returns null if none exists. */
export async function loadSession(): Promise<SessionData | null> {
  try {
    const db = await openDB();
    const manifest = await idbGet<SessionManifest>(db, 'state', 'current');
    if (!manifest || manifest.layers.length === 0) {
      db.close();
      return null;
    }

    // Load pixel blobs
    const pixels = new Map<string, Blob>();
    const keys = await idbGetAllKeys(db, 'pixels');
    for (const key of keys) {
      const blob = await idbGet<Blob>(db, 'pixels', key);
      if (blob) pixels.set(key, blob);
    }

    // Load history pixel blobs
    const historyPixels = new Map<string, Blob>();
    const hKeys = await idbGetAllKeys(db, 'history-pixels');
    for (const key of hKeys) {
      const blob = await idbGet<Blob>(db, 'history-pixels', key);
      if (blob) historyPixels.set(key, blob);
    }

    db.close();

    // Restore curve control points
    if (manifest.curvePoints) {
      importAllCurvePoints(manifest.curvePoints);
    }

    return { manifest, pixels, historyPixels };
  } catch {
    return null;
  }
}

/** Deserialize layers from a session manifest. */
export function deserializeSessionLayers(manifest: SessionManifest): Layer[] {
  return manifest.layers.map(deserializeLayer);
}

/** Clear saved session data. */
export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    await idbClear(db, 'state');
    await idbClear(db, 'pixels');
    await idbClear(db, 'history-pixels');
    db.close();
  } catch {
    // Silently ignore — session storage is best-effort
  }
}
