import { editorDocument } from '@/core/document';
import type { SourceMeta } from '@/core/document';
import { toast } from '@/components/ui/Toast';
import { developRawFile, needsBackendDevelop, RAW_ACCEPT } from './raw-image';

// Explicit extensions, NO `image/*` wildcard: macOS (Chromium/Electron) greys
// out any file whose MIME isn't image/* when the wildcard is present — which
// includes camera RAW (.arw/.nef/… have no image MIME) even when the extension
// is also listed. Listing extensions explicitly keeps every format selectable.
const WEB_IMAGE_ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.tif,.tiff,.ico,.svg';
const ACCEPT = `${WEB_IMAGE_ACCEPT},${RAW_ACCEPT}`;

/**
 * Resolve a picked file to something `createImageBitmap` can decode plus an
 * optional `source` identity. Web-native images pass through. Camera RAW and
 * TIFF (Chromium can't decode TIFF) are developed to a (16-bit PNG) by the
 * backend, and their `source` carries the original name / format / size so the
 * editor presents them as the original, not the PNG transport. Returns null
 * (after a toast) when the develop round-trip fails.
 */
export async function resolveImageFile(
  file: File,
): Promise<{ file: File; source?: SourceMeta } | null> {
  if (!needsBackendDevelop(file)) return { file };
  try {
    const developed = await developRawFile(file);
    const dot = file.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : file.name.slice(dot + 1).toUpperCase();
    return { file: developed, source: { name: file.name, format: ext || 'RAW', fileSize: file.size } };
  } catch (err) {
    console.warn('[develop] failed:', err);
    toast.error('Could not decode this image.');
    return null;
  }
}

export function openImageFromPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const resolved = await resolveImageFile(file);
    if (resolved) await editorDocument.openImage(resolved.file, resolved.source);
  };
  input.click();
}

export function addImageFromPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const resolved = await resolveImageFile(file);
    if (resolved) await editorDocument.addImage(resolved.file, resolved.source);
  };
  input.click();
}
