import { editorDocument } from '@/core/document';

export function openImageFromPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await editorDocument.openImage(file);
  };
  input.click();
}
