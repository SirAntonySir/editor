/**
 * Walk the layer list and seed pixelStore from IndexedDB for any image layer
 * that has a persisted source blob. Failures (missing blob, decode error)
 * are non-fatal: that layer stays empty and the next one is tried.
 */
import { useEditorStore } from '@/store';
import { pixelStore } from './pixel-store';
import { getSource } from './pixel-source-store';

export async function restorePixelSources(sessionId: string): Promise<void> {
  const layers = useEditorStore.getState().layers;
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    try {
      const blob = await getSource(sessionId, layer.id);
      if (!blob) continue;
      const bitmap = await createImageBitmap(blob);
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = source.getContext('2d');
      if (ctx) ctx.drawImage(bitmap, 0, 0);
      pixelStore.register(layer.id, source);
      bitmap.close();
    } catch (err) {
      console.warn('[restore-pixel-sources] failed for layer', layer.id, err);
    }
  }
}
