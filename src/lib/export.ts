import { CanvasRegistry } from './canvas-registry';
import { PipelineManager } from './pipeline-manager';
import { useEditorStore } from '@/store';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

interface ExportOptions {
  format: ExportFormat;
  quality: number; // 0..1
  layerId?: string;
}

export async function exportImage(options: ExportOptions): Promise<Blob | null> {
  const { format, quality, layerId } = options;
  const state = useEditorStore.getState();
  const targetLayerId = layerId ?? state.activeLayerId;
  if (!targetLayerId) return null;

  const layer = state.layers.find((l) => l.id === targetLayerId);
  if (!layer) return null;

  // Render through pipeline at full resolution
  const adjustments = layer.adjustmentStack.adjustments;
  let sourceCanvas: HTMLCanvasElement | OffscreenCanvas | undefined;

  if (adjustments.length > 0) {
    sourceCanvas = PipelineManager.renderSync(adjustments);
  } else {
    sourceCanvas = CanvasRegistry.get(targetLayerId);
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
