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
    // Full close: clears layers, workspace nodes/edges, pixel data,
    // history, AND the persisted backend session (incl. its localStorage
    // entry). `newDocument()` only swaps the document meta — it leaves
    // imageNodes / widgetNodes on the canvas, which read as ghost items
    // after the user hits File → Close.
    editorDocument.closeDocument();
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
