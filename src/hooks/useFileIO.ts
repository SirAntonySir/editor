import { useCallback } from 'react';
import { exportImage, saveAs } from '@/lib/export';
import { editorDocument } from '@/core/document';
import { openImageFromPicker, addImageFromPicker } from '@/lib/open-file';

export function useFileIO() {
  const handleOpen = useCallback(() => {
    openImageFromPicker();
  }, []);

  const handleAddImage = useCallback(() => {
    addImageFromPicker();
  }, []);

  const handleClose = useCallback(() => {
    editorDocument.newDocument();
  }, []);

  const handleExport = useCallback(
    async (format: 'png' | 'jpeg' | 'webp') => {
      const blob = await exportImage({ format, quality: format === 'jpeg' ? 0.92 : 1 });
      if (blob) {
        await saveAs(blob, `export.${format === 'jpeg' ? 'jpg' : format}`);
      }
    },
    [],
  );

  return { handleOpen, handleAddImage, handleClose, handleExport };
}
