import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { renderImageNodeComposite } from './image-node-renderer';
import { computeEffectiveSize, type Crop } from './image-node-geometry';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

/** Read this image-node's rotate angle + crop rect straight from the snapshot's
 *  transform nodes — the same source the on-screen hook (`useImageNodeRender`)
 *  uses to size the visible canvas. Returns nulls when no transform is present. */
function readNodeTransforms(imageNodeId: string): { rotateAngle: number | null; crop: Crop | null } {
  const nodes = useBackendState.getState().snapshot?.operationGraph.nodes ?? [];
  const r = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
  const c = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
  const rotateAngle = r ? ((r.params as { angle?: number }).angle ?? null) : null;
  const cp = c?.params as { x?: number; y?: number; w?: number; h?: number } | undefined;
  const crop =
    cp && cp.w != null && cp.h != null
      ? { x: cp.x ?? 0, y: cp.y ?? 0, w: cp.w, h: cp.h }
      : null;
  return { rotateAngle, crop };
}

/**
 * Render an image-node to a fresh canvas using the SAME pipeline the editor
 * paints on screen (`renderImageNodeComposite`): per-layer adjustments,
 * node-scope (composite-then-apply) adjustments, and the crop/rotate geometry
 * pass — at full source resolution, with the overlay pass suppressed.
 *
 * This is what makes export WYSIWYG. The previous export went through the
 * legacy `LayerCompositor.renderLayer`, which never ran the geometry pass and
 * diverged in node selection, so saved files came out as the untouched
 * original. Returns null when the node is missing.
 */
export function renderImageNodeToCanvas(imageNodeId: string): HTMLCanvasElement | null {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node) return null;

  const backend = useBackendState.getState();
  const { rotateAngle, crop } = readNodeTransforms(imageNodeId);
  const eff = computeEffectiveSize(node.sourceSize, rotateAngle, crop);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(eff.w));
  canvas.height = Math.max(1, Math.round(eff.h));

  renderImageNodeComposite({
    canvas,
    imageNodeId,
    layerIds: node.layerIds,
    sourceWidth: node.sourceSize.w,
    sourceHeight: node.sourceSize.h,
    opGraph: backend.snapshot?.operationGraph,
    widgets: backend.snapshot?.widgets ?? [],
    optimistic: backend.optimistic,
    renderScale: 1,
    skipOverlays: true,
  });

  return canvas;
}

/** Encode a canvas to a Blob in the requested format. */
export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), `image/${format}`, quality);
  });
}

/** Render an image-node WYSIWYG and encode it to a Blob, or null on failure. */
export async function exportImageNodeBlob(
  imageNodeId: string,
  format: ExportFormat,
  quality: number,
): Promise<Blob | null> {
  const canvas = renderImageNodeToCanvas(imageNodeId);
  if (!canvas) return null;
  return canvasToBlob(canvas, format, quality);
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
