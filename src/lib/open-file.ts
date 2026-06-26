import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';
import { developRawFile, isRawFile, RAW_ACCEPT } from './raw-image';

const ACCEPT = `image/*,${RAW_ACCEPT}`;

/**
 * Resolve a picked file to something `createImageBitmap` can decode. Web-native
 * images pass through; camera RAW is developed to a JPEG by the backend first.
 * Returns null (after a toast) when a RAW can't be developed.
 */
async function resolveImageFile(file: File): Promise<File | null> {
  if (!isRawFile(file)) return file;
  try {
    return await developRawFile(file);
  } catch (err) {
    console.warn('[raw] develop failed:', err);
    toast.error('Could not develop this RAW file.');
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
    if (resolved) await editorDocument.openImage(resolved);
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
    if (resolved) await editorDocument.addImage(resolved);
  };
  input.click();
}
