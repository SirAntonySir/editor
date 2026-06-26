import { editorDocument } from '@/core/document';
import { useEditorStore } from '@/store';
import { toast } from '@/components/ui/Toast';
import { isRawFile } from './raw-image';
import { resolveImageFile } from './open-file';

// Web-native image extensions accepted on drop. RAW is handled separately via
// isRawFile (RAW has no image/* MIME). Mirrors the picker's accept list.
const WEB_IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif',
  'tif', 'tiff', 'ico', 'svg',
]);

/** Is this dropped file something we can open — a web image (by MIME or
 *  extension) or a camera RAW (by extension)? */
export function isAcceptedImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  if (isRawFile(file)) return true;
  const dot = file.name.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
  return WEB_IMAGE_EXTENSIONS.has(ext);
}

/** Filter a dropped FileList/array down to openable image/RAW files, in order. */
export function imageFilesFromList(files: Iterable<File>): File[] {
  return Array.from(files).filter(isAcceptedImageFile);
}

/**
 * Open files dropped onto the canvas. The first file replaces the document only
 * when the canvas is empty; otherwise every file is added alongside the
 * existing ones (matching the Open-vs-Add picker semantics). RAW files are
 * developed via `resolveImageFile` first. Sequential by design — opening the
 * first creates the backend session that the rest attach to (avoids the
 * concurrent-upload session race noted in document.ts).
 */
export async function openDroppedFiles(files: Iterable<File>): Promise<void> {
  const accepted = imageFilesFromList(files);
  if (accepted.length === 0) {
    toast.error('No image files in that drop.');
    return;
  }
  const hadDocument = useEditorStore.getState().layers.length > 0;
  for (let i = 0; i < accepted.length; i++) {
    const resolved = await resolveImageFile(accepted[i]);
    if (!resolved) continue; // resolveImageFile already toasted (e.g. RAW develop failed)
    if (i === 0 && !hadDocument) {
      await editorDocument.openImage(resolved.file, resolved.source);
    } else {
      await editorDocument.addImage(resolved.file, resolved.source);
    }
  }
}
