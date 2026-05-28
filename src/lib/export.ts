import { LayerCompositor } from './layer-compositor';
import { useEditorStore } from '@/store';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

interface ExportOptions {
  format: ExportFormat;
  quality: number; // 0..1
  layerId?: string; // Export a single layer, or all visible layers if omitted
}

export async function exportImage(options: ExportOptions): Promise<Blob | null> {
  const { format, quality, layerId } = options;
  const state = useEditorStore.getState();

  let sourceCanvas: HTMLCanvasElement | OffscreenCanvas | undefined;

  if (layerId) {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    sourceCanvas = LayerCompositor.renderLayer(layer) ?? undefined;
  } else {
    sourceCanvas = LayerCompositor.compositeSync();
  }

  if (!sourceCanvas) return null;

  // Convert to blob
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = sourceCanvas.width;
  tmpCanvas.height = sourceCanvas.height;
  const ctx = tmpCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(sourceCanvas, 0, 0);

  const mimeType = `image/${format}`;
  return new Promise<Blob | null>((resolve) => {
    tmpCanvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      quality,
    );
  });
}

export async function saveAs(blob: Blob, filename: string): Promise<void> {
  // Try File System Access API first (Chrome/Edge)
  if ('showSaveFilePicker' in window) {
    try {
      const ext = filename.split('.').pop() ?? 'png';
      const types: Record<string, { description: string; accept: Record<string, string[]> }> = {
        png: { description: 'PNG Image', accept: { 'image/png': ['.png'] } },
        jpeg: { description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
        webp: { description: 'WebP Image', accept: { 'image/webp': ['.webp'] } },
      };

      const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> })
        .showSaveFilePicker({
          suggestedName: filename,
          types: [types[ext] ?? types.png],
        });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch {
      // User cancelled or API unavailable — fall through
    }
  }

  // Fallback: download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function readExif(file: File): Promise<Record<string, unknown> | null> {
  try {
    const exifr = await import('exifr');
    return await exifr.default.parse(file);
  } catch {
    return null;
  }
}
