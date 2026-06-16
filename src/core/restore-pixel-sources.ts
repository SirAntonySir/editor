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
  // Snapshot taken once; mutations during restore are ignored.
  const layers = useEditorStore.getState().layers;
  let restored = 0;
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    let bitmap: ImageBitmap | null = null;
    try {
      const blob = await getSource(sessionId, layer.id);
      if (!blob) continue;
      bitmap = await createImageBitmap(blob);
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = source.getContext('2d');
      if (!ctx) {
        console.warn('[restore-pixel-sources] no 2d context for layer', layer.id);
        continue;
      }
      ctx.drawImage(bitmap, 0, 0);
      pixelStore.register(layer.id, source);
      restored += 1;
      // Bump per-layer so each layer's image-node repaints as soon as its
      // source lands, instead of all waiting for the slowest layer's
      // decode. Cheap (single number write).
      useEditorStore.getState().bumpPixelVersion();
    } catch (err) {
      console.warn('[restore-pixel-sources] failed for layer', layer.id, err);
    } finally {
      bitmap?.close();
    }
  }
  if (restored === 0) {
    console.warn('[restore-pixel-sources] no layers restored for session', sessionId);
  }
}
