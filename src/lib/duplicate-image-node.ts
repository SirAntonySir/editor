/**
 * Duplicate the active image node — Cmd+D entry point.
 *
 * Pulls the working bitmap from `pixelStore` for the active image node's
 * primary layer, converts it to a PNG blob, wraps it in a File, and routes
 * through `editorDocument.addImage`. That gets us the same upload-to-
 * backend / IndexedDB-source-persist / new-layer wiring that the file
 * picker uses — at the cost of one PNG encode hop per duplicate, which is
 * fine for the click frequency.
 *
 * Multi-layer image nodes flatten to their first layer's bitmap for the
 * duplicate. Compositing several layers + adjustment widgets into one
 * bitmap before duplicating is a future feature.
 */
import { editorDocument } from '@/core/document';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { toast } from '@/components/ui/Toast';

/** Duplicate the currently-active image node. No-op + toast when there
 *  isn't one. Returns the new node's id, or null on failure. */
export async function duplicateActiveImageNode(): Promise<string | null> {
  const editor = useEditorStore.getState();
  const id = editor.activeImageNodeId;
  if (!id) {
    toast.info('No image selected to duplicate.');
    return null;
  }
  const node = editor.imageNodes[id];
  if (!node || node.layerIds.length === 0) {
    toast.info('No image selected to duplicate.');
    return null;
  }

  const primaryLayerId = node.layerIds[0];
  const canvas = pixelStore.getSource(primaryLayerId);
  if (!canvas) {
    toast.error('Image data unavailable. Try reloading the document.');
    return null;
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const sourceLayer = editor.layers.find((l) => l.id === primaryLayerId);
  const baseName = node.name ?? sourceLayer?.name ?? 'image.png';
  const dupName = deriveDuplicateName(baseName);
  const file = new File([blob], dupName, { type: 'image/png' });

  // addImage promotes the new node only when nothing was active — we WANT
  // the user to see the duplicate appear next to the source and keep their
  // selection on the original, so the existing semantics are correct here.
  await editorDocument.addImage(file);
  return useEditorStore.getState().activeImageNodeId ?? null;
}

/** Append " copy" before the extension. `foo.jpg` → `foo copy.jpg`,
 *  `foo copy.jpg` → `foo copy 2.jpg`, etc. */
export function deriveDuplicateName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  const copyMatch = stem.match(/ copy(?: (\d+))?$/);
  if (!copyMatch) return `${stem} copy${ext}`;
  const n = copyMatch[1] ? parseInt(copyMatch[1], 10) : 1;
  const root = stem.slice(0, stem.length - copyMatch[0].length);
  return `${root} copy ${n + 1}${ext}`;
}
