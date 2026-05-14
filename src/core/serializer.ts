/**
 * Serializer — .edp file save/load using fflate ZIP.
 *
 * .edp format (ZIP):
 *   manifest.json     — DocumentMeta + layers + graphPositions + viewport
 *   pixels/{id}-source.png
 *   pixels/{id}-working.png  (only if differs from source)
 *   thumbnail.png     — 256px preview
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { DocumentMeta, SerializableParams, SerializableState, HistoryTreeSnapshot } from './types';
import type { Layer, Adjustment } from '@/store/layer-slice';
import type { NodePosition } from '@/types/graph';
import { pixelStore } from './pixel-store';
import { exportAllCurvePoints, importAllCurvePoints } from '@/lib/curve-points-store';
import { migrateV1ToV2, isV1 } from './serializer-migrate';

// ─── Manifest types ─────────────────────────────────────────────────

interface SerializableAdjustment {
  id: string;
  type: Adjustment['type'];
  name: string;
  enabled: boolean;
  blendMode: Adjustment['blendMode'];
  opacity: number;
  params: SerializableParams;
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
  hasWorkingPixels: boolean;
}

interface Manifest {
  version: 2;
  meta: DocumentMeta;
  layers: SerializableLayer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  curvePoints?: Record<string, Record<string, number[]>>;
  history: HistoryTreeSnapshot;
}

// ─── Helpers ────────────────────────────────────────────────────────

function serializeParams(
  params: Record<string, number | Float32Array>,
): SerializableParams {
  const result: SerializableParams = {};
  for (const [key, value] of Object.entries(params)) {
    // Use duck-typing: Immer proxies break instanceof Float32Array
    if (typeof value === 'object' && value !== null && 'length' in value) {
      result[key] = Array.from(value as Float32Array);
    } else {
      result[key] = value as number;
    }
  }
  return result;
}

function deserializeParams(
  params: SerializableParams,
): Record<string, number | Float32Array> {
  const result: Record<string, number | Float32Array> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = Array.isArray(value) ? new Float32Array(value) : value;
  }
  return result;
}

function serializeLayer(layer: Layer, hasWorkingPixels: boolean): SerializableLayer {
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
      })),
    },
    textMeta: layer.textMeta,
    cropMeta: layer.cropMeta,
    hasWorkingPixels,
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
      })),
    },
    textMeta: sl.textMeta,
    cropMeta: sl.cropMeta,
  };
}

async function generateThumbnail(): Promise<Uint8Array> {
  // Find the first image layer for thumbnail
  const firstLayerId = Array.from(
    // Access internal canvases via the public API
    { length: pixelStore.size },
  );
  // Simple approach: just create a small placeholder
  const thumb = new OffscreenCanvas(256, 256);
  const ctx = thumb.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 256, 256);
  }
  void firstLayerId; // unused, we iterate differently

  // Try to render actual thumbnail from first available layer
  // We don't have direct access to iterate the map, so we'll skip for now
  const blob = await thumb.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

// ─── Save ───────────────────────────────────────────────────────────

export interface SaveOptions {
  meta: DocumentMeta;
  layers: Layer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  history: HistoryTreeSnapshot;
  /** key format: `${nodeId}:${pre|post}:${layerId}` */
  pixelBlobs: Map<string, Blob>;
}

export async function save(options: SaveOptions): Promise<Blob> {
  const { meta, layers, activeLayerId, graphPositions, viewport, history, pixelBlobs } = options;
  const files: Record<string, Uint8Array> = {};

  // Layer pixel snapshots (unchanged from v1)
  const serializableLayers: SerializableLayer[] = [];
  for (const layer of layers) {
    let hasWorkingPixels = false;
    if (pixelStore.has(layer.id)) {
      const sourceBlob = await pixelStore.exportLayerAsPng(layer.id, 'source');
      files[`pixels/${layer.id}-source.png`] = new Uint8Array(await sourceBlob.arrayBuffer());
      const workingBlob = await pixelStore.exportLayerAsPng(layer.id, 'working');
      const sourceSize = sourceBlob.size;
      const workingSize = workingBlob.size;
      if (Math.abs(sourceSize - workingSize) > 100) {
        files[`pixels/${layer.id}-working.png`] = new Uint8Array(await workingBlob.arrayBuffer());
        hasWorkingPixels = true;
      }
    }
    serializableLayers.push(serializeLayer(layer, hasWorkingPixels));
  }

  // History pixel blobs under history/{nodeId}/{pre|post}/{layerId}.png
  for (const [key, blob] of pixelBlobs) {
    const [nodeId, kind, layerId] = key.split(':');
    files[`history/${nodeId}/${kind}/${layerId}.png`] = new Uint8Array(await blob.arrayBuffer());
  }

  const manifest: Manifest = {
    version: 2,
    meta,
    layers: serializableLayers,
    activeLayerId,
    graphPositions,
    viewport,
    curvePoints: exportAllCurvePoints(),
    history,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['thumbnail.png'] = await generateThumbnail();

  const zipped = zipSync(files, { level: 6 });
  return new Blob([new Uint8Array(zipped)], { type: 'application/x-edp' });
}

// ─── Load ───────────────────────────────────────────────────────────

export interface LoadResult {
  meta: DocumentMeta;
  layers: Layer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  history: HistoryTreeSnapshot;
  historyPixelBlobs: Map<string, Blob>;
}

export async function load(blob: Blob): Promise<LoadResult> {
  const buffer = await blob.arrayBuffer();
  const files = unzipSync(new Uint8Array(buffer));

  const manifestData = files['manifest.json'];
  if (!manifestData) throw new Error('Invalid .edp: missing manifest.json');
  const raw = JSON.parse(strFromU8(manifestData));

  let manifest: Manifest;
  if (raw.version === 2) {
    manifest = raw as Manifest;
  } else if (isV1(raw)) {
    const layersFromV1 = (raw.layers as SerializableLayer[]).map(deserializeLayer);
    const rootState: SerializableState = {
      layers: layersFromV1,
      activeLayerId: raw.activeLayerId,
      pixelVersion: 0,
      graphPositions: raw.graphPositions as Record<string, NodePosition>,
    };
    const migrated = migrateV1ToV2(raw, rootState);
    // The migrated manifest carries the v1 layers as `unknown[]`; coerce to SerializableLayer[]
    // for type consistency with our local `Manifest` shape.
    manifest = {
      version: 2,
      meta: migrated.meta,
      layers: migrated.layers as SerializableLayer[],
      activeLayerId: migrated.activeLayerId,
      graphPositions: migrated.graphPositions as Record<string, NodePosition>,
      viewport: migrated.viewport,
      curvePoints: migrated.curvePoints,
      history: migrated.history,
    };
  } else {
    throw new Error(`Unsupported .edp manifest version: ${raw.version}`);
  }

  // Layer pixel loading (unchanged from v1)
  for (const sl of manifest.layers) {
    const sourceData = files[`pixels/${sl.id}-source.png`];
    if (sourceData) {
      const sourceBlob = new Blob([new Uint8Array(sourceData)], { type: 'image/png' });
      await pixelStore.importLayerFromPng(sl.id, sourceBlob, 'source');
      if (sl.hasWorkingPixels) {
        const workingData = files[`pixels/${sl.id}-working.png`];
        if (workingData) {
          const workingBlob = new Blob([new Uint8Array(workingData)], { type: 'image/png' });
          await pixelStore.importLayerFromPng(sl.id, workingBlob, 'working');
        }
      }
    }
  }

  // History pixel blobs
  const historyPixelBlobs = new Map<string, Blob>();
  for (const path of Object.keys(files)) {
    const match = path.match(/^history\/([^/]+)\/(pre|post)\/([^/]+)\.png$/);
    if (!match) continue;
    const [, nodeId, kind, layerId] = match;
    historyPixelBlobs.set(
      `${nodeId}:${kind}:${layerId}`,
      new Blob([new Uint8Array(files[path])], { type: 'image/png' }),
    );
  }

  if (manifest.curvePoints) importAllCurvePoints(manifest.curvePoints);

  return {
    meta: manifest.meta,
    layers: manifest.layers.map(deserializeLayer),
    activeLayerId: manifest.activeLayerId,
    graphPositions: manifest.graphPositions,
    viewport: manifest.viewport,
    history: manifest.history,
    historyPixelBlobs,
  };
}
