import { editorDocument } from '@/core/document';
import { useAiSession } from '@/hooks/useImageContext';

export function openImageFromPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await editorDocument.openImage(file);
    createImageBitmap(file).then((bitmap) =>
      useAiSession.getState().uploadAndAnalyse(bitmap),
    );
  };
  input.click();
}
