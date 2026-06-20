/**
 * Walk the layer list and seed pixelStore from IndexedDB for any image layer
 * that has a persisted source blob. Failures (missing blob, decode error)
 * are non-fatal: that layer stays empty and the next one is tried.
 *
 * pixelStore is a plain Map — registering a source does NOT notify the
 * render pipeline. The pipeline subscribes to `pixelVersion` on the editor
 * store, so we bump that counter after each registration to fire a
 * re-render against the freshly-loaded source. Without the bump, the
 * canvas stays gray after a reload until some other state change happens
 * to trigger paint (slider drag, tool switch, etc.).
 */
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import { getSource } from './pixel-source-store';

export async function restorePixelSources(sessionId: string): Promise<void> {
  const t0 = performance.now();
  // Snapshot taken once; mutations during restore are ignored.
  const layers = useEditorStore.getState().layers;
  const imageLayers = layers.filter((l) => l.type === 'image');
  console.log('[reload] restorePixelSources start', {
    sessionId,
    totalLayers: layers.length,
    imageLayers: imageLayers.length,
    layerIds: imageLayers.map((l) => l.id),
  });
  let restored = 0;
  let missingBlob = 0;
  let decodeFailed = 0;
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    let bitmap: ImageBitmap | null = null;
    const tLayer = performance.now();
    try {
      const blob = await getSource(sessionId, layer.id);
      if (!blob) {
        missingBlob += 1;
        console.warn('[reload] no blob for layer', layer.id, '— putSource at openImage/addImage may not have run, or IDB was cleared');
        continue;
      }
      console.log('[reload] got blob for layer', layer.id, { bytes: blob.size, type: blob.type });
      bitmap = await createImageBitmap(blob);
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = source.getContext('2d');
      if (!ctx) {
        decodeFailed += 1;
        console.warn('[reload] no 2d context for layer', layer.id);
        continue;
      }
      ctx.drawImage(bitmap, 0, 0);
      pixelStore.register(layer.id, source);
      restored += 1;
      const versionBefore = useEditorStore.getState().pixelVersion;
      useEditorStore.getState().bumpPixelVersion();
      const versionAfter = useEditorStore.getState().pixelVersion;
      console.log('[reload] registered + bumped', layer.id, {
        w: bitmap.width,
        h: bitmap.height,
        pixelVersion: `${versionBefore} → ${versionAfter}`,
        ms: Math.round(performance.now() - tLayer),
      });
    } catch (err) {
      decodeFailed += 1;
      console.warn('[reload] failed for layer', layer.id, err);
    } finally {
      bitmap?.close();
    }
  }
  console.log('[reload] restorePixelSources done', {
    sessionId,
    restored,
    missingBlob,
    decodeFailed,
    pixelStoreSize: pixelStore.size,
    totalMs: Math.round(performance.now() - t0),
  });
  if (restored === 0 && imageLayers.length > 0) {
    console.warn('[reload] WARNING: image layers exist but none restored — check IDB pixel-source-store entries for this session');
  }
}
